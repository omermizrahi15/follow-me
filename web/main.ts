// Browser entry for the join page. Wires the existing SubscribeUseCase +
// Supabase repository to the DOM and the framework-agnostic JoinController.
// Bundled by `npm run build:web` (esbuild) into web/join.js. This file is
// intentionally outside the app's tsconfig `include` (it touches the DOM).
import { SupabaseSubscriberRepository } from '../src/infrastructure/repositories/SupabaseSubscriberRepository';
import { SubscribeUseCase } from '../src/application/usecases/SubscribeUseCase';
import { JoinController, parsePublisherId } from '../src/web/joinPage';

// Injected at build time by esbuild --define (see scripts/build-web.mjs).
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

const repo = new SupabaseSubscriberRepository(__SUPABASE_URL__, __SUPABASE_ANON_KEY__);
const controller = new JoinController(
  new SubscribeUseCase(repo),
  () => crypto.randomUUID(),
);

const publisherId = parsePublisherId(window.location.pathname);

const form = document.getElementById('join-form') as HTMLFormElement;
const phoneInput = document.getElementById('phone') as HTMLInputElement;
const submitButton = document.getElementById('submit') as HTMLButtonElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const formView = document.getElementById('form-view') as HTMLElement;
const successView = document.getElementById('success-view') as HTMLElement;
const confirmedNumber = document.getElementById('confirmed-number') as HTMLElement;

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Subscribing…';

  void controller.submit(publisherId, phoneInput.value).then((state) => {
    if (state.status === 'success') {
      confirmedNumber.textContent = state.contactHandle;
      formView.hidden = true;
      successView.hidden = false;
      return;
    }
    if (state.status === 'error') {
      showError(state.message);
    }
    submitButton.disabled = false;
    submitButton.textContent = 'Subscribe';
  });
});
