let API_KEY = "AIzaSyBhZCGZOZbIa3mV9H6a3d91TDyFGkeXLfU"; // Default, will be overwritten if stored in chrome.storage

// Attempt to get API key from storage at start
chrome.storage.sync.get(["apiKey"], function (result) {
  if (result.apiKey) {
    API_KEY = result.apiKey;
  }
});

console.log("Content script loaded");

// Add a simple cache to store previous suggestions
const suggestionCache = new Map();
const CACHE_SIZE_LIMIT = 50; // Maximum number of items in cache

// Add request queue management
let pendingRequest = null;

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
    const timeoutId = setTimeout(async () => {
      // Actual API call
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateText?key=${API_KEY}`;

      const requestBody = {
        prompt: { text: prompt },
        temperature: 0.7,
        maxOutputTokens: 20,
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        console.log("API Response:", data);
        if (data && data.candidates && data.candidates.length > 0) {
          const suggestion = data.candidates[0].output;

          // Add to cache
          suggestionCache.set(prompt, suggestion);

          // Manage cache size
          if (suggestionCache.size > CACHE_SIZE_LIMIT) {
            const firstKey = suggestionCache.keys().next().value;
            suggestionCache.delete(firstKey);
          }

          resolve(suggestion);
        } else {
          resolve("");
        }
      } catch (error) {
        console.error("Error fetching AI suggestion:", error);
        resolve("");
      }

      pendingRequest = null;
    }, 100); // Short delay before actual API call

    pendingRequest = { timeoutId, prompt };
  });
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

// Event listeners for text inputs with optimized debounce
document.addEventListener(
  "input",
  debounce(async function (event) {
    // Check if autocomplete is enabled
    if (localStorage.getItem("aiAutocomplete") !== "true") {
      return; // Exit early if disabled
    }

    const target = event.target;
    if (target.tagName === "TEXTAREA" || target.isContentEditable) {
      const text = target.value || target.innerText;

      // Only proceed if text meets minimum length and ends with a meaningful character
      if (text.trim().length >= MIN_TEXT_LENGTH) {
        console.log("Detected input:", text);
        const suggestion = await fetchSuggestion(text);
        console.log("Suggestion:", suggestion);
        insertSuggestion(target, suggestion);
      }
    }
  }, DEBOUNCE_DELAY)
);

// Insert AI-generated suggestions
function insertSuggestion(target, suggestion) {
  if (!suggestion) return;
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

// Handle "Tab" key to accept suggestions with improved performance
document.addEventListener("keydown", function (event) {
  // Check if autocomplete is enabled
  if (localStorage.getItem("aiAutocomplete") !== "true") {
    return; // Exit early if disabled
  }

  if (event.key === "Tab") {
    event.preventDefault();
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
