// The pill shown while Scorpion types what you say (main/dictation.js calls
// showDictation): listening, typing, or what went wrong.
window.showDictation = ({ state, message, theme }) => {
  if (theme) document.documentElement.dataset.theme = theme;
  document.getElementById('pill').dataset.state = state;
  document.getElementById('words').textContent = state === 'error' ? message || 'Typing stopped' : state === 'typing' ? 'Typing…' : 'Listening… speak, and it’s typed';
  document.getElementById('hint').textContent = state === 'error' ? '' : 'say “stop typing”';
};
