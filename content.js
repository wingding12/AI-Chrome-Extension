let API_KEY = "AIzaSyBhZCGZOZbIa3mV9H6a3d91TDyFGkeXLfU"; // Hardcoded API key

// Attempt to get API key from storage at start
chrome.storage.sync.get(["apiKey"], function (result) {
  if (result.apiKey) {
    API_KEY = result.apiKey;
    console.log("API key loaded from storage");
  }
});

console.log("Content script loaded");

// Check and log initial autocomplete state
const initialState = localStorage.getItem("aiAutocomplete") === "true";
console.log(
  "AI Autocomplete initially:",
  initialState ? "ENABLED" : "DISABLED"
);

// Add listener for localStorage changes
window.addEventListener("storage", function (e) {
  if (e.key === "aiAutocomplete") {
    console.log(
      "AI Autocomplete state changed to:",
      e.newValue === "true" ? "ENABLED" : "DISABLED"
    );
  }
});

// Add after loading from storage
// Check if aiAutocomplete is set at all
if (localStorage.getItem("aiAutocomplete") === null) {
  console.log("Initializing aiAutocomplete state to false");
  localStorage.setItem("aiAutocomplete", "false");
}

// Improved cache with frequency tracking
class SuggestionCache {
  constructor(sizeLimit = 50) {
    this.cache = new Map();
    this.sizeLimit = sizeLimit;
    this.accessCount = new Map();
  }

  has(key) {
    return this.cache.has(key);
  }

  get(key) {
    if (this.cache.has(key)) {
      // Increment access count
      this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
      return this.cache.get(key);
    }
    return null;
  }

  set(key, value) {
    this.cache.set(key, value);
    this.accessCount.set(key, 1);

    // Manage size by removing least frequently accessed items
    if (this.cache.size > this.sizeLimit) {
      let leastFrequentKey = null;
      let lowestCount = Infinity;

      for (const [entryKey, count] of this.accessCount.entries()) {
        if (count < lowestCount) {
          lowestCount = count;
          leastFrequentKey = entryKey;
        }
      }

      if (leastFrequentKey) {
        this.cache.delete(leastFrequentKey);
        this.accessCount.delete(leastFrequentKey);
      }
    }
  }

  keys() {
    return this.cache.keys();
  }

  size() {
    return this.cache.size;
  }
}

// Replace the simple Map with our improved cache
const suggestionCache = new SuggestionCache(50);

// Add request queue management
let pendingRequest = null;

// Add network condition awareness
let networkCondition = "fast"; // Default assumption

// Monitor connection quality
function updateNetworkCondition() {
  // Use the Navigation Timing API to estimate network speed
  if (window.performance && window.performance.timing) {
    const navStart = window.performance.timing.navigationStart;
    const responseEnd = window.performance.timing.responseEnd;
    const loadTime = responseEnd - navStart;

    if (loadTime < 1000) {
      networkCondition = "fast";
    } else if (loadTime < 3000) {
      networkCondition = "medium";
    } else {
      networkCondition = "slow";
    }
  }

  // Also check if online
  if (navigator.onLine === false) {
    networkCondition = "offline";
  }
}

// Call this periodically or after API responses
updateNetworkCondition();

// Adjust behavior based on network conditions
function getNetworkAwareDelay() {
  switch (networkCondition) {
    case "fast":
      return 400;
    case "medium":
      return 600;
    case "slow":
      return 800;
    case "offline":
      return 2000; // Longer delay to avoid wasted calls
    default:
      return 500;
  }
}

// Main suggestion fetching function - simplified for Gemini only
async function fetchSuggestion(prompt) {
  // Cancel any pending request for a new one
  if (pendingRequest) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest = null;
  }

  // Check cache first
  if (suggestionCache.has(prompt)) {
    console.log("Using cached suggestion for:", prompt);
    return suggestionCache.get(prompt);
  }

  // Create a promise that can be awaited
  return new Promise((resolve) => {
    // Adjust timeout based on network conditions
    const timeoutDelay = networkCondition === "offline" ? 0 : 100;

    const timeoutId = setTimeout(async () => {
      // Skip API call if offline
      if (networkCondition === "offline") {
        console.log("Device is offline, skipping API call");
        resolve("");
        return;
      }

      try {
        console.log("Fetching suggestion from Gemini API");
        const suggestion = await fetchFromGemini(prompt);

        if (suggestion) {
          console.log("Received valid suggestion from Gemini");
          // Add to cache
          suggestionCache.set(prompt, suggestion);

          // Manage cache size
          if (suggestionCache.size > suggestionCache.sizeLimit) {
            const firstKey = suggestionCache.keys().next().value;
            suggestionCache.delete(firstKey);
          }

          resolve(suggestion);
        } else {
          console.log("No suggestion received from Gemini");
          resolve("");
        }
      } catch (error) {
        console.error("Error fetching Gemini suggestion:", error);
        resolve("");
      }

      // Update network condition after API response
      updateNetworkCondition();
      pendingRequest = null;
    }, timeoutDelay);

    pendingRequest = { timeoutId, prompt };
  });
}

// Enhanced autocomplete function with better text handling
async function fetchFromGemini(prompt) {
  // First, identify the current word being typed and clean up the prompt
  const cleanPrompt = prompt.trim();
  const words = cleanPrompt.split(/\s+/);
  const currentPartialWord = words[words.length - 1];

  // Get surrounding context (previous words)
  const previousContext = words.slice(-15, -1).join(" ");

  // Get document context by examining nearby elements
  const documentContext = extractDocumentContext();

  // Get website domain for context
  const domain = window.location.hostname;

  // Detect if we're at the end of a full word (space after) or in the middle of typing
  const isPartialWord =
    currentPartialWord.length > 0 && !/\s$/.test(cleanPrompt);
  const isCodeContext = isCodeEditor(document.activeElement);

  // Format a context-aware prompt with better instructions to avoid repetition
  const formattedPrompt = `You are an advanced AI autocomplete system that provides two types of completions:

1. WORD COMPLETION: When given a partial word, provide the COMPLETE word, not just the missing part.
2. SENTENCE/CODE COMPLETION: When given a complete sentence or code fragment, predict the next logical words or code.

Website: ${domain}
Document Context: ${documentContext}
Current Text: "${previousContext}"
${
  isPartialWord
    ? `Partial Word: "${currentPartialWord}"`
    : `Complete Phrase: "${cleanPrompt}"`
}
Detected Environment: ${isCodeContext ? "CODE" : "TEXT"}

I need a ${isPartialWord ? "WORD COMPLETION" : "SENTENCE/CODE COMPLETION"}.

${
  isPartialWord
    ? `For the partial word "${currentPartialWord}", provide the FULL word it likely completes to (e.g., "progra" → "programming", not just "mming").`
    : `Continue the text/code naturally with 2-7 words that would logically follow after this exact text. DO NOT REPEAT any part of "${cleanPrompt}" in your completion.`
}

${
  isCodeContext
    ? "For code, focus on common patterns, variable names, function calls, or syntax that would typically follow."
    : "For text, focus on completing the thought or sentence naturally without redundancy."
}

IMPORTANT: Your response should ONLY contain the completion - no explanations, no quotation marks, no labels, and NEVER repeat words that are already in the input text.`;

  // Use the Gemini 1.5 Flash model
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: formattedPrompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: isPartialWord ? 0.01 : 0.2, // Lower temperature for word completion, slightly higher for sentence
      maxOutputTokens: isPartialWord ? 3 : 15, // Fewer tokens for word completion, more for sentence
      topP: 0.95,
      topK: 40,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    // Check for HTTP errors
    if (!response.ok) {
      console.error(`API Error: ${response.status} ${response.statusText}`);
      console.log("Response:", await response.text());
      return "";
    }

    const data = await response.json();
    console.log("Gemini API Response:", data);

    // Properly process the response
    if (
      data &&
      data.candidates &&
      data.candidates.length > 0 &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts.length > 0
    ) {
      let suggestion = data.candidates[0].content.parts[0].text.trim();

      // Clean up the suggestion to remove any explanations or quotation marks
      suggestion = suggestion.replace(/^["']|["']$/g, "");

      // If the suggestion contains explanation text, try to extract just the completion
      if (suggestion.includes(":") || suggestion.includes("=")) {
        const parts = suggestion.split(/[:=]/);
        if (parts.length > 1) {
          suggestion = parts[1].trim();
        }
      }

      // For sentence completions, check for and remove redundancy with the original text
      if (!isPartialWord) {
        // Check if the suggestion starts with any of the last few words of the prompt
        const lastWordsOfPrompt = cleanPrompt
          .split(/\s+/)
          .slice(-3)
          .join(" ")
          .toLowerCase();

        // Check if the suggestion repeats these last words
        if (
          lastWordsOfPrompt &&
          suggestion.toLowerCase().startsWith(lastWordsOfPrompt)
        ) {
          // Remove the duplicated part
          suggestion = suggestion.substring(lastWordsOfPrompt.length).trim();
        }

        // Also check for partial word matches at the start
        const promptWords = cleanPrompt.split(/\s+/);
        const suggestionWords = suggestion.split(/\s+/);

        if (suggestionWords.length > 0 && promptWords.length > 0) {
          const lastPromptWord =
            promptWords[promptWords.length - 1].toLowerCase();
          const firstSuggestionWord = suggestionWords[0].toLowerCase();

          // If the first word of suggestion matches the last word of prompt
          if (lastPromptWord === firstSuggestionWord) {
            // Remove the first word of the suggestion
            suggestion = suggestionWords.slice(1).join(" ");
          }
        }
      }

      // Ensure we have a full word if we sent a partial word
      if (currentPartialWord && suggestion && isPartialWord) {
        // Logic for partial word completions
        // ...existing code
      }

      console.log("Processed suggestion:", suggestion);
      return suggestion;
    } else {
      console.log("No valid suggestion in Gemini response");
      return "";
    }
  } catch (error) {
    console.error("Error with Gemini API:", error);
    return "";
  }
}

// Helper function to extract document context
function extractDocumentContext() {
  // Get the active element
  const activeElement = document.activeElement;

  // Try to find a heading or title element to understand document purpose
  let heading = "";

  // Check for page title
  if (document.title) {
    heading = document.title;
  }

  // Try to find a nearby heading if we're in an article or form
  if (activeElement) {
    // Look for headings above the active element
    const headings = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, .title, .heading"
    );
    headings.forEach((el) => {
      if (
        el.getBoundingClientRect().top <
        activeElement.getBoundingClientRect().top
      ) {
        heading = el.textContent.trim();
      }
    });

    // Check if we're in a specific element like a code editor
    const codeParent = findParentWithClass(activeElement, [
      "code",
      "editor",
      "CodeMirror",
      "monaco-editor",
    ]);
    if (codeParent) {
      return `This is a code editor. Current document appears to be ${detectLanguage(
        codeParent
      )}. ${heading}`;
    }

    // Check if we're in a form
    const formParent = findParentWithTag(activeElement, "form");
    if (formParent) {
      return `This is a form input. ${heading}`;
    }
  }

  return heading;
}

// Helper to find parent with specific class
function findParentWithClass(element, classNames) {
  while (element) {
    for (const className of classNames) {
      if (element.classList && element.classList.contains(className)) {
        return element;
      }
    }
    element = element.parentElement;
  }
  return null;
}

// Helper to find parent with specific tag
function findParentWithTag(element, tagName) {
  while (element) {
    if (
      element.tagName &&
      element.tagName.toLowerCase() === tagName.toLowerCase()
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

// Attempt to detect code language
function detectLanguage(codeElement) {
  // Look for language classes
  const classesString = Array.from(codeElement.classList).join(" ");

  if (classesString.includes("javascript") || classesString.includes("js")) {
    return "JavaScript";
  } else if (classesString.includes("python") || classesString.includes("py")) {
    return "Python";
  } else if (classesString.includes("java")) {
    return "Java";
  } else if (classesString.includes("cpp") || classesString.includes("c++")) {
    return "C++";
  } else if (classesString.includes("html")) {
    return "HTML";
  }

  // Check text content for language indicators
  const text = codeElement.textContent.toLowerCase();
  if (text.includes("function") && text.includes("const")) {
    return "JavaScript";
  } else if (text.includes("def") && text.includes("import")) {
    return "Python";
  } else if (
    text.includes("public class") ||
    text.includes("public static void")
  ) {
    return "Java";
  } else if (text.includes("#include") || text.includes("int main")) {
    return "C++";
  }

  return "code";
}

// Alternative with a different API
async function fetchFromAlternativeAPI(prompt) {
  // Use a different free AI API
  const endpoint = "https://api.openai.com/v1/completions"; // This would need your own API key

  // Request structure would change based on the selected API
  // ...
}

// Debounce function to limit API calls
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Adjust debounce delay for better balance between responsiveness and API calls
const DEBOUNCE_DELAY = 500; // Increased from 300ms to 500ms

// Add minimum text length before triggering API
const MIN_TEXT_LENGTH = 3;

// Add visual feedback class
function showLoadingIndicator(target) {
  // Add a subtle visual indicator that autocomplete is working
  target.classList.add("ai-autocomplete-loading");

  // Remove the indicator after a short time or when suggestion arrives
  setTimeout(() => {
    target.classList.remove("ai-autocomplete-loading");
  }, 800);
}

// Add predictive fetching for common patterns
function getPredictivePrompts(text) {
  // Generate variations of the current text to prefetch
  const words = text.trim().split(/\s+/);

  // Don't predict if too few words
  if (words.length < 2) return [];

  const predictive = [];

  // Add a period to see completions for sentence endings
  predictive.push(text + ".");

  // Add common conjunctions
  predictive.push(text + " and");
  predictive.push(text + " but");
  predictive.push(text + " because");

  return predictive;
}

// Modify the input event listener
document.addEventListener(
  "input",
  debounce(async function (event) {
    // Log every input event
    console.log("Input event detected on:", event.target.tagName);

    // Check if autocomplete is enabled
    const autocompleteEnabled =
      localStorage.getItem("aiAutocomplete") === "true";
    console.log("Autocomplete enabled:", autocompleteEnabled);

    if (!autocompleteEnabled) {
      console.log("Autocomplete is disabled, skipping");
      return; // Exit early if disabled
    }

    const target = event.target;
    if (target.tagName === "TEXTAREA" || target.isContentEditable) {
      const text = target.value || target.innerText;
      console.log("Input text:", text);

      // Only proceed if text meets minimum length
      if (text.trim().length >= MIN_TEXT_LENGTH) {
        console.log("Text meets minimum length, fetching suggestion");
        showLoadingIndicator(target);

        // Fetch the immediate suggestion
        const suggestion = await fetchSuggestion(text);
        console.log("Received suggestion:", suggestion);

        // Create overlay instead of inserting text
        if (suggestion) {
          createSuggestionOverlay(target, suggestion);
          console.log("Created suggestion overlay");
        } else {
          console.log("No suggestion received");
        }

        // Predictive fetching (in the background)
        if (text.trim().length > 15) {
          // Only for substantial text
          const predictivePrompts = getPredictivePrompts(text);
          // Fetch these in the background without awaiting
          for (const prompt of predictivePrompts) {
            fetchSuggestion(prompt); // Will be cached for future use
          }
        }
      } else {
        console.log("Text too short, min length required:", MIN_TEXT_LENGTH);
      }
    } else {
      console.log("Target is not a textarea or contentEditable element");
    }
  }, DEBOUNCE_DELAY)
);

// Improved insertSuggestion function for both types of completions
function insertSuggestion(target, suggestion) {
  if (!suggestion) return;

  // Clean up the suggestion if needed
  suggestion = suggestion.trim();

  // Check if the suggestion includes explanatory text and remove it
  if (suggestion.includes("\n")) {
    suggestion = suggestion.split("\n")[0].trim();
  }

  // Get text and cursor position
  let text = "";
  let cursorPos = 0;

  if (target.tagName === "TEXTAREA") {
    text = target.value;
    cursorPos = target.selectionStart;
  } else if (target.isContentEditable) {
    text = target.innerText;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      cursorPos = selection.getRangeAt(0).startOffset;
    }
  }

  // Find the current word being typed
  let wordStart = cursorPos;
  while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
    wordStart--;
  }

  const currentWord = text.substring(wordStart, cursorPos);

  // Determine if we're in a sentence completion context
  const isSentenceCompletion =
    currentWord.length === 0 || /\s$/.test(text.substring(0, cursorPos));

  if (isSentenceCompletion) {
    // For sentence completion
    // Check for redundancy before adding spaces
    const lastFewChars = text.substring(Math.max(0, cursorPos - 10), cursorPos);

    // If the suggestion starts with text that's already at the cursor, trim it
    if (suggestion.length > 3) {
      for (let i = 3; i < Math.min(suggestion.length, 10); i++) {
        const overlapCandidate = suggestion.substring(0, i);
        if (lastFewChars.endsWith(overlapCandidate)) {
          suggestion = suggestion.substring(i);
          break;
        }
      }
    }

    // Add a space if needed and not already present
    if (
      !/^[\s.,!?;:]/.test(suggestion) &&
      cursorPos > 0 &&
      text.charAt(cursorPos - 1) !== " " &&
      text.charAt(cursorPos - 1) !== "\n"
    ) {
      suggestion = " " + suggestion;
    }
  }

  // Insert the suggestion
  if (target.tagName === "TEXTAREA") {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    target.setRangeText(suggestion, start, end, "end");
  } else if (target.isContentEditable) {
    const range = document.getSelection().getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(suggestion));
    range.collapse(false);
  }
}

// Handle "Tab" key to accept suggestions for both word and sentence completions
document.addEventListener("keydown", function (event) {
  // Check if autocomplete is enabled
  const autocompleteEnabled = localStorage.getItem("aiAutocomplete") === "true";

  if (!autocompleteEnabled) {
    return; // Exit early if disabled
  }

  if (event.key === "Tab") {
    console.log("Tab key pressed");
    event.preventDefault();

    // Remove any existing overlay
    const existingOverlay = document.querySelector(".ai-suggestion-overlay");
    if (existingOverlay) {
      // Get the full suggestion and completion type
      const fullSuggestion =
        existingOverlay.dataset.fullSuggestion ||
        existingOverlay.querySelector(".suggestion-text").textContent;
      const completionType = existingOverlay.dataset.completionType || "word";

      console.log(
        `Found ${completionType} suggestion in overlay:`,
        fullSuggestion
      );
      existingOverlay.remove();

      const activeElement = document.activeElement;
      if (
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable
      ) {
        console.log("Inserting suggestion on Tab key press");

        // Get text and cursor position
        let text = "";
        let cursorPos = 0;

        if (activeElement.tagName === "TEXTAREA") {
          text = activeElement.value;
          cursorPos = activeElement.selectionStart;
        } else if (activeElement.isContentEditable) {
          text = activeElement.innerText;
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            cursorPos = selection.getRangeAt(0).startOffset;
          }
        }

        // Find the current word being typed
        let wordStart = cursorPos;
        while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
          wordStart--;
        }

        const currentWord = text.substring(wordStart, cursorPos);

        if (completionType === "word" && currentWord.length > 0) {
          // Word completion - replace the partial word
          if (activeElement.tagName === "TEXTAREA") {
            activeElement.setRangeText(
              fullSuggestion,
              wordStart,
              cursorPos,
              "end"
            );
          } else if (activeElement.isContentEditable) {
            const range = document.getSelection().getRangeAt(0);
            range.setStart(range.startContainer, wordStart);
            range.deleteContents();
            range.insertNode(document.createTextNode(fullSuggestion));
            range.collapse(false);
          }
        } else {
          // Sentence completion - insert after cursor
          insertSuggestion(activeElement, fullSuggestion);
        }
        return;
      }
    }

    // If no overlay, proceed with normal suggestion flow
    const activeElement = document.activeElement;
    if (
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable
    ) {
      const text = activeElement.value || activeElement.innerText;

      // Check cache first to avoid unnecessary API calls
      if (suggestionCache.has(text)) {
        insertSuggestion(activeElement, suggestionCache.get(text));
        return;
      }

      // If not in cache, fetch from API
      fetchSuggestion(text).then((suggestion) => {
        insertSuggestion(activeElement, suggestion);
      });
    }
  }
});

// Save frequently used suggestions to local storage for persistence
function saveCacheToStorage() {
  const topItems = [];
  const entries = [];

  // Get most frequently used items
  const sortedEntries = Array.from(suggestionCache.accessCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Only store top 10

  for (const [key, count] of sortedEntries) {
    if (suggestionCache.has(key)) {
      entries.push([key, suggestionCache.get(key), count]);
    }
  }

  try {
    localStorage.setItem("aiAutocompleteCache", JSON.stringify(entries));
  } catch (e) {
    console.log("Failed to save cache to storage", e);
  }
}

// Load cache from storage on startup
function loadCacheFromStorage() {
  try {
    const data = localStorage.getItem("aiAutocompleteCache");
    if (data) {
      const entries = JSON.parse(data);
      for (const [key, value, count] of entries) {
        suggestionCache.set(key, value);
        suggestionCache.accessCount.set(key, count);
      }
    }
  } catch (e) {
    console.log("Failed to load cache from storage", e);
  }
}

// Call this on extension startup
loadCacheFromStorage();

// Save cache periodically or when the tab is closed
window.addEventListener("beforeunload", saveCacheToStorage);

// Modified createSuggestionOverlay for both word and sentence completions
function createSuggestionOverlay(target, suggestion) {
  // Remove existing overlay if present
  const existingOverlay = document.querySelector(".ai-suggestion-overlay");
  if (existingOverlay) {
    existingOverlay.remove();
  }

  if (!suggestion) return;

  // Get text and cursor position
  let text = "";
  let cursorPos = 0;

  if (target.tagName === "TEXTAREA") {
    text = target.value;
    cursorPos = target.selectionStart;
  } else if (target.isContentEditable) {
    text = target.innerText;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      cursorPos = selection.getRangeAt(0).startOffset;
    }
  }

  // Find the current word being typed
  let wordStart = cursorPos;
  while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
    wordStart--;
  }

  const currentWord = text.substring(wordStart, cursorPos);
  const isPartialWord = currentWord.length > 0;

  // Create the overlay
  const overlay = document.createElement("div");
  overlay.className = "ai-suggestion-overlay";

  // Get target's position and style
  const rect = target.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(target);

  // Calculate cursor position
  const cursorPosition = calculateCursorPosition(target, cursorPos);

  // Create suggestion text
  const suggestionText = document.createElement("span");
  suggestionText.className = "suggestion-text";

  // Store the entire suggestion for use when tab is pressed
  overlay.dataset.fullSuggestion = suggestion;

  // Store whether this is a word completion or sentence completion
  overlay.dataset.completionType = isPartialWord ? "word" : "sentence";

  // Handle display of the suggestion
  if (isPartialWord) {
    // For partial words
    if (suggestion.toLowerCase().startsWith(currentWord.toLowerCase())) {
      // Show only the completion part
      const completionPart = suggestion.substring(currentWord.length);
      if (completionPart.length > 0) {
        suggestionText.textContent = completionPart;
      } else {
        suggestionText.textContent = "[" + suggestion + "]";
      }
    } else {
      // If suggestion doesn't extend the current word, show with an indicator
      suggestionText.textContent = "⮕ " + suggestion;
    }
  } else {
    // For sentence completions, always show with a space prefix
    if (!suggestion.startsWith(" ") && !suggestion.startsWith("\n")) {
      suggestion = " " + suggestion;
    }
    suggestionText.textContent = suggestion;
  }

  // Apply target's styling to overlay
  overlay.style.position = "absolute";
  overlay.style.left = `${rect.left + cursorPosition.left}px`;
  overlay.style.top = `${rect.top + cursorPosition.top}px`;
  overlay.style.font = computedStyle.font;
  overlay.style.lineHeight = computedStyle.lineHeight;
  overlay.style.color = "rgba(150, 150, 150, 0.8)";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999";
  overlay.style.whiteSpace = "pre";

  // Use different styling for different completion types
  if (!isPartialWord) {
    suggestionText.style.fontStyle = "italic";
    suggestionText.style.opacity = "0.85";
    suggestionText.style.borderLeft = "2px solid #1a73e8";
    suggestionText.style.paddingLeft = "4px";
  }

  overlay.appendChild(suggestionText);
  document.body.appendChild(overlay);

  return overlay;
}

// Helper function to calculate cursor position
function calculateCursorPosition(target, cursorPos) {
  const computedStyle = window.getComputedStyle(target);

  if (target.tagName === "TEXTAREA") {
    // Create a temporary element to measure text width
    const textBeforeCursor = target.value.substring(0, cursorPos);
    const span = document.createElement("span");
    span.style.visibility = "hidden";
    span.style.position = "absolute";
    span.style.whiteSpace = "pre";
    span.style.font = computedStyle.font;
    span.textContent = textBeforeCursor;
    document.body.appendChild(span);

    // Calculate cursor X position
    const textWidth = span.getBoundingClientRect().width;
    document.body.removeChild(span);

    // Calculate the line height and number of line breaks
    const lineHeight = parseInt(computedStyle.lineHeight);
    const lineBreaks = (textBeforeCursor.match(/\n/g) || []).length;

    return {
      left: textWidth % target.getBoundingClientRect().width,
      top: lineHeight * lineBreaks,
    };
  } else {
    // For contentEditable elements, use Selection API
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const tempRange = range.cloneRange();
    tempRange.collapse(true);

    // Get the bounding client rect of the cursor position
    const rangeRect = tempRange.getBoundingClientRect();
    return {
      left: rangeRect.left - target.getBoundingClientRect().left,
      top: rangeRect.top - target.getBoundingClientRect().top,
    };
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "updateApiKey") {
    API_KEY = message.key;
    console.log("API key updated");
  }
});

// Helper function to detect if we're in a code editor
function isCodeEditor(element) {
  if (!element) return false;

  // Check element and its parents for code editor indicators
  let currentEl = element;
  while (currentEl) {
    // Check for common code editor class names
    const classList = currentEl.classList
      ? Array.from(currentEl.classList)
      : [];
    if (
      classList.some((cls) =>
        /code|editor|CodeMirror|monaco|ace|prism|syntax|highlight|language-|javascript|python|java|cpp|ruby|php/i.test(
          cls
        )
      )
    ) {
      return true;
    }

    // Check for code elements
    if (currentEl.tagName === "PRE" || currentEl.tagName === "CODE") {
      return true;
    }

    // Check for common code editor IDs
    if (currentEl.id && /editor|code|script|source/i.test(currentEl.id)) {
      return true;
    }

    // Check for Monaco editor
    if (currentEl.querySelector && currentEl.querySelector(".monaco-editor")) {
      return true;
    }

    // Check URL for coding sites
    const codingDomains = [
      "github.com",
      "gitlab.com",
      "bitbucket.org",
      "stackoverflow.com",
      "leetcode.com",
      "hackerrank.com",
      "codepen.io",
      "jsfiddle.net",
      "codesandbox.io",
      "replit.com",
      "codewars.com",
      "ide.geeksforgeeks.org",
    ];

    if (
      codingDomains.some((domain) => window.location.hostname.includes(domain))
    ) {
      return true;
    }

    currentEl = currentEl.parentElement;
  }

  return false;
}
