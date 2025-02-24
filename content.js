// Import the API key from the environment variables
const API_KEY = process.env.API_KEY;

async function fetchSuggestion(prompt) {
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
    if (data && data.candidates && data.candidates.length > 0) {
      return data.candidates[0].output;
    }
  } catch (error) {
    console.error("Error fetching AI suggestion:", error);
  }

  return "";
}

// Debounce function to limit API calls
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Event listeners for text inputs with debounce
document.addEventListener(
  "input",
  debounce(async function (event) {
    const target = event.target;
    if (target.tagName === "TEXTAREA" || target.isContentEditable) {
      const text = target.value || target.innerText;
      if (text.trim().length > 0) {
        const suggestion = await fetchSuggestion(text);
        insertSuggestion(target, suggestion);
      }
    }
  }, 300)
); // Adjust the debounce delay as needed

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

// Handle "Tab" key to accept suggestions
document.addEventListener("keydown", function (event) {
  if (event.key === "Tab") {
    event.preventDefault();
    const activeElement = document.activeElement;
    if (
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable
    ) {
      const text = activeElement.value || activeElement.innerText;
      fetchSuggestion(text).then((suggestion) => {
        insertSuggestion(activeElement, suggestion);
      });
    }
  }
});
