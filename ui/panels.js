export function setPanelOpen(panelElement, isOpen) {
  if (!panelElement) return;
  panelElement.classList.toggle("hidden", !isOpen);
}
