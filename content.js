let API_KEY = "AIzaSyBhZCGZOZbIa3mV9H6a3d91TDyFGkeXLfU"; // Default, will be overwritten if stored in chrome.storage

// Attempt to get API key from storage at start
chrome.storage.sync.get(["apiKey"], function (result) {
  if (result.apiKey) {
    API_KEY = result.apiKey;
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
        resolve("");
        return;
      }

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
          if (suggestionCache.size > suggestionCache.sizeLimit) {
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

      // Update network condition after API response
      updateNetworkCondition();

      pendingRequest = null;
    }, timeoutDelay);

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
      const suggestion =
        existingOverlay.querySelector(".suggestion-text").textContent;
      console.log("Found suggestion in overlay:", suggestion);
      existingOverlay.remove();

      const activeElement = document.activeElement;
      if (
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable
      ) {
        console.log("Inserting suggestion on Tab key press");
        insertSuggestion(activeElement, suggestion);
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

// Create a suggestion overlay that matches the textarea's styling
function createSuggestionOverlay(target, suggestion) {
  // Remove existing overlay if present
  const existingOverlay = document.querySelector(".ai-suggestion-overlay");
  if (existingOverlay) {
    existingOverlay.remove();
  }

  if (!suggestion) return;

  const overlay = document.createElement("div");
  overlay.className = "ai-suggestion-overlay";

  // Get target's position and style
  const rect = target.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(target);

  // Calculate cursor position
  let cursorPosition;
  if (target.tagName === "TEXTAREA") {
    const selectionStart = target.selectionStart;

    // Create a temporary element to measure text width
    const textBeforeCursor = target.value.substring(0, selectionStart);
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

    cursorPosition = {
      left: textWidth % rect.width,
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
    cursorPosition = {
      left: rangeRect.left - rect.left,
      top: rangeRect.top - rect.top,
    };
  }

  // Create suggestion text
  const suggestionText = document.createElement("span");
  suggestionText.className = "suggestion-text";
  suggestionText.textContent = suggestion;

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

  overlay.appendChild(suggestionText);
  document.body.appendChild(overlay);

  return overlay;
}
