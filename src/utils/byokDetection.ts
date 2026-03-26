export const hasStoredByokKey = () =>
  !!(
    localStorage.getItem("openaiApiKey") ||
    localStorage.getItem("groqApiKey") ||
    localStorage.getItem("mistralApiKey") ||
    localStorage.getItem("chimegeApiKey") ||
    localStorage.getItem("customTranscriptionApiKey")
  );
