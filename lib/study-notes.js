export function addSessionStudyNote(notes, concept) {
  const normalizedConcept = String(concept || "").trim();
  if (!normalizedConcept) {
    return [...notes];
  }

  const normalizedKey = normalizedConcept.toLocaleLowerCase();
  const existingIndex = notes.findIndex(
    (note) => note.concept.toLocaleLowerCase() === normalizedKey
  );

  if (existingIndex === -1) {
    return [
      ...notes,
      {
        concept: normalizedConcept,
        source: "coreKnowledge",
        count: 1
      }
    ];
  }

  return notes.map((note, index) =>
    index === existingIndex
      ? { ...note, count: note.count + 1 }
      : note
  );
}

export function clearSessionStudyNotes() {
  return [];
}
