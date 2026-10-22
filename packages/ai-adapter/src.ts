/** Explicit data boundary for a future provider. No credentials or paid API calls in V0.1. */
export interface PromptRequest { title: string; seedText: string; category: string; template: string }
export interface PromptProvider { readonly name: string; generate(request: PromptRequest): Promise<string> }
const mechanics: Record<string, string> = {
  puzzle: 'Arrange and rotate the themed pieces to satisfy each visible objective. Start with a tutorial puzzle, then introduce one new constraint per level. Allow undo and a limited hint.',
  rhythm: 'Tap or press the matching lane as a beat marker crosses its target. Start at a slow tempo and gradually add alternating patterns; include visual beat cues so audio is optional.',
  precision: 'Aim and release the themed object toward clearly marked targets. Display a trajectory preview; add moving targets and limited shots as rounds progress.',
  timing: 'Time a single action to keep the themed system inside a visible safe zone. Shorten the timing window gradually; offer clear early/late feedback.',
  physics: 'Drag and stack themed objects on a small physics platform. Keep the stack balanced for a three-second hold; introduce gentle wind after each successful round.',
  arcade: 'Move the themed character through short rounds, collect targets, and avoid moving obstacles. Introduce one new obstacle pattern per round.',
};
export class TemplatePromptProvider implements PromptProvider {
  readonly name = 'TEMPLATE_FALLBACK';
  async generate(request: PromptRequest) {
    return `${request.template}\n\nTitle: ${request.title}\nConcept: ${request.seedText}\nCore gameplay: ${mechanics[request.category] ?? mechanics.arcade}\nControls: Arrow keys / WASD or number keys on desktop; large labelled touch targets and drag controls on mobile. Explain controls before play.\nGoal & end: Complete as many objectives as possible within 3 minutes; end when the timer expires or three attempts are lost. Include pause and restart.\nScoring & feedback: +10 per completed objective, +5 after three consecutive successes; show score, remaining time and attempts. Provide readable feedback, not colour alone.\nStyle: Playful 2D shapes, readable contrast, reduced-motion option, optional audio, no external assets required.\nCompatibility: Responsive mobile and desktop layout; touch and keyboard support.\nResults: Show final score, best streak, a replay button and a user-initiated shareable text result. Build a playable game, not a static page.`;
  }
}
