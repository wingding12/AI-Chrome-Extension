document.addEventListener("DOMContentLoaded", async () => {
  // Query the active tab to check its state
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Execute script to get the current state from the tab
  if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        function: getCurrentState,
      },
      (results) => {
        // Use the result from the content script
        const enabled = results && results[0] && results[0].result === true;
        updateButtonUI(enabled);
      }
    );
  } else {
    // Default state for non-web pages
    updateButtonUI(false);
  }

  // Setup API key UI
  document.getElementById("showSettings").addEventListener("click", () => {
    const section = document.getElementById("apiKeySection");
    section.style.display =
      section.style.display === "block" ? "none" : "block";
  });

  // Load existing API key
  chrome.storage.sync.get(["apiKey"], function (result) {
    if (result.apiKey) {
      document.getElementById("apiKey").value = result.apiKey;
    }
  });

  // Save API key
  document.getElementById("saveApiKey").addEventListener("click", () => {
    const apiKey = document.getElementById("apiKey").value;
    chrome.storage.sync.set({ apiKey: apiKey }, function () {
      alert("API key saved successfully!");

      // Update content script
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateApiKey",
            key: apiKey,
          });
        }
      });
    });
  });
});

document.getElementById("toggleAI").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Check if the URL is valid for content script execution
  if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        function: toggleAutocomplete,
      },
      (results) => {
        // Update UI based on the returned state
        const enabled = results && results[0] && results[0].result === true;
        updateButtonUI(enabled);
      }
    );
  } else {
    alert("AI Autocomplete cannot be enabled on this page.");
  }
});

// Function that runs in content script to get current state
function getCurrentState() {
  return localStorage.getItem("aiAutocomplete") === "true";
}

// Function that runs in content script to toggle state
function toggleAutocomplete() {
  let enabled = localStorage.getItem("aiAutocomplete") === "true";
  enabled = !enabled; // Toggle the state
  localStorage.setItem("aiAutocomplete", enabled);
  alert(`AI Autocomplete is now ${enabled ? "enabled" : "disabled"}!`);
  return enabled; // Return the new state
}

// Update the UI based on the state
function updateButtonUI(enabled) {
  const button = document.getElementById("toggleAI");
  button.textContent = enabled ? "Disable Autocomplete" : "Enable Autocomplete";
}
