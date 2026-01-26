const resizeTextarea = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  const maxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight || '0');
  const clamped = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
  el.style.height = `${clamped}px`;
};

export { resizeTextarea };
