document.getElementById("toggleAI").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: toggleAutocomplete,
  });
});

function toggleAutocomplete() {
  let enabled = localStorage.getItem("aiAutocomplete") === "true";
  localStorage.setItem("aiAutocomplete", !enabled);
  alert(`AI Autocomplete is now ${!enabled ? "enabled" : "disabled"}!`);
}
