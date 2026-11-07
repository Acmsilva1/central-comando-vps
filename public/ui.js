import { createFeedback } from './ui/organisms/feedback.mjs';
// Padrão visual compartilhado com o tema banco do Super App.
(() => {
  const storageKey='superapp-ui-theme';
  function applyTheme(theme){document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#171a1f':'#ffffff');document.querySelectorAll('[data-theme-toggle]').forEach(button=>{button.textContent=theme==='dark'?'☀ Tema claro':'☾ Tema escuro';button.setAttribute('aria-label',theme==='dark'?'Usar tema claro':'Usar tema escuro');});}
  let saved;try{saved=localStorage.getItem(storageKey);}catch{}
  applyTheme(saved==='dark'?'dark':'light');
  document.addEventListener('click',event=>{if(!event.target.closest('[data-theme-toggle]'))return;const next=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(next);try{localStorage.setItem(storageKey,next);}catch{}});
  const {confirm,toast,closeConfirmation}=createFeedback();
  window.AppUI={confirm,toast,applyTheme,closeConfirmation};
})();
