const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const activeRequests = new Map();
let processingRequestId = null;

chrome.action.onClicked.addListener((tab) => {
  if (Number.isInteger(tab.id)) {
    chrome.tabs
      .sendMessage(tab.id, { type: "QB_OPEN_SIDEBAR" })
      .catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "start-crop") {
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (Number.isInteger(tab?.id)) {
    chrome.tabs
      .sendMessage(tab.id, { type: "QB_START_CROP" })
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "QB_GET_MODEL_STATUS") {
    handleGetModelStatus(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not check the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_PREPARE_MODEL") {
    handlePrepareModel(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not prepare the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_CAPTURE_PROCESS_LOCAL") {
    handleCaptureProcessLocal(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unknown error"
        });
      });

    return true;
  }

  if (message.type === "QB_ANALYZE_TEXT_LOCAL") {
    handleLocalTask(message, sender, "QB_OFFSCREEN_ANALYZE_TEXT")
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not analyze the edited OCR text."
        });
      });

    return true;
  }

  if (message.type === "QB_DELETE_MODEL") {
    handleLocalTask(message, sender, "QB_OFFSCREEN_DELETE_MODEL")
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not delete the local model."
        });
      });

    return true;
  }

  if (message.type === "QB_RELEASE_RESOURCES") {
    handleReleaseResources()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Could not release local AI resources."
        });
      });

    return true;
  }

  if (
    message.type === "QB_PROCESS_PROGRESS" ||
    message.type === "QB_PROCESS_PARTIAL"
  ) {
    const tabId = activeRequests.get(message.requestId);
    if (Number.isInteger(tabId)) {
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }
  }

  return false;
});

async function handleGetModelStatus(message) {
  const documentCreated = await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage({
      type: "QB_OFFSCREEN_MODEL_STATUS",
      modelId: message.modelId
    });
  } finally {
    if (documentCreated) {
      await closeOffscreenDocument();
    }
  }
}

async function handleReleaseResources() {
  if (processingRequestId) {
    return {
      ok: false,
      busy: true,
      error: "Local processing is still running."
    };
  }

  if (
    typeof chrome.offscreen?.hasDocument === "function" &&
    !(await chrome.offscreen.hasDocument())
  ) {
    return { ok: true };
  }

  try {
    return await chrome.runtime.sendMessage({
      type: "QB_OFFSCREEN_RELEASE_RESOURCES"
    });
  } finally {
    await closeOffscreenDocument();
  }
}

async function handlePrepareModel(message, sender) {
  const tabId = sender.tab?.id;
  const requestId = String(message.requestId || "");

  if (!Number.isInteger(tabId) || !requestId) {
    throw new Error("Cannot prepare the model from this page.");
  }

  if (processingRequestId) {
    throw new Error(
      "QuizBuddy AI is busy with another local processing task."
    );
  }

  processingRequestId = requestId;
  activeRequests.set(requestId, tabId);

  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: "QB_OFFSCREEN_PREPARE_MODEL",
      requestId,
      modelId: message.modelId
    });

    if (!response) {
      throw new Error("The model loader did not return a result.");
    }

    return response;
  } finally {
    activeRequests.delete(requestId);
    if (processingRequestId === requestId) {
      processingRequestId = null;
    }
  }
}

async function handleCaptureProcessLocal(message, sender) {
  const windowId = sender.tab?.windowId;
  const tabId = sender.tab?.id;
  const requestId = String(message.requestId || "");

  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) {
    throw new Error("Cannot capture this page because its browser window is unavailable.");
  }

  if (!requestId) {
    throw new Error("The processing request ID is missing.");
  }

  if (processingRequestId) {
    throw new Error(
      "QuizBuddy AI is already processing another question. Please wait for it to finish."
    );
  }

  validateRect(message.rect);
  processingRequestId = requestId;
  activeRequests.set(requestId, tabId);

  try {
    let screenshotDataUrl;
    try {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "png"
      });
    } catch (error) {
      throw new Error(`Failed to capture the visible tab: ${error.message}`);
    } finally {
      chrome.tabs
        .sendMessage(tabId, { type: "QB_CAPTURE_FINISHED" })
        .catch(() => {});
    }

    try {
      await ensureOffscreenDocument();
    } catch (error) {
      throw new Error(`Failed to create the offscreen document: ${error.message}`);
    }

    const response = await chrome.runtime.sendMessage({
      type: "QB_OFFSCREEN_PROCESS_IMAGE",
      requestId,
      screenshotDataUrl,
      rect: message.rect,
      modelId: message.modelId,
      ocrLanguage: message.ocrLanguage
    });

    if (!response) {
      throw new Error("The offscreen document did not return a processing result.");
    }

    return response;
  } finally {
    activeRequests.delete(requestId);
    if (processingRequestId === requestId) {
      processingRequestId = null;
    }
  }
}

async function handleLocalTask(message, sender, offscreenType) {
  const tabId = sender.tab?.id;
  const requestId = String(message.requestId || "");

  if (!Number.isInteger(tabId) || !requestId) {
    throw new Error("Cannot run this local task from the current page.");
  }

  if (processingRequestId) {
    throw new Error(
      "QuizBuddy AI is busy with another local processing task."
    );
  }

  processingRequestId = requestId;
  activeRequests.set(requestId, tabId);

  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      ...message,
      type: offscreenType
    });

    if (!response) {
      throw new Error("The offscreen document did not return a result.");
    }

    return response;
  } finally {
    activeRequests.delete(requestId);
    if (processingRequestId === requestId) {
      processingRequestId = null;
    }
  }
}

function validateRect(rect) {
  const values = [rect?.x, rect?.y, rect?.width, rect?.height];
  if (!values.every(Number.isFinite) || rect.width < 30 || rect.height < 30) {
    throw new Error("The crop area is invalid or too small.");
  }
}

async function ensureOffscreenDocument() {
  if (typeof chrome.offscreen?.hasDocument === "function") {
    if (await chrome.offscreen.hasDocument()) {
      return false;
    }
  } else {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const clients = await self.clients.matchAll();
    if (clients.some((client) => client.url === offscreenUrl)) {
      return false;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["DOM_PARSER"],
      justification:
        "Process screenshot image with canvas, OCR, and local WebLLM inference."
    });
    return true;
  } catch (error) {
    // Concurrent requests can both observe that no document exists.
    if (!String(error.message).includes("Only a single offscreen")) {
      throw error;
    }
    return false;
  }
}

async function closeOffscreenDocument() {
  if (
    typeof chrome.offscreen?.hasDocument === "function" &&
    !(await chrome.offscreen.hasDocument())
  ) {
    return;
  }

  await chrome.offscreen.closeDocument();
}
