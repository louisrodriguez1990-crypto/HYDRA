import { call } from "./openrouter";
import { MODELS } from "./models";

const FIRST_PRINCIPLES = `You are a first-principles thinker. For the given problem:

1. HARD CONSTRAINTS: What are the absolute physical, logical, mathematical, or legal constraints that CANNOT be violated? Not conventions. Not norms. Only laws of reality.

2. STRIPPED ASSUMPTIONS: What does the current approach assume that isn't actually a hard constraint? List every convention, habit, and "how it's done" that COULD be different.

3. REBUILD FROM SCRATCH: You're an alien engineer who has never seen how humans do this. Starting from ONLY the hard constraints, design 3 solutions. They should look weird at first. Be specific and concrete — each solution detailed enough to actually evaluate.`;

const ANALOGIES = `You are a cross-domain analogy expert. For the given problem, find 4 structurally similar problems from COMPLETELY UNRELATED fields. Not surface-similar — structurally similar.

For each analogy:
1. Source domain (as far from the problem's field as possible)
2. The analogous problem in that domain
3. How that domain solved it
4. How that solution maps back to the original problem in SPECIFIC, ACTIONABLE terms

Pick from: biology, physics, music, cooking, military strategy, sports, game design, urban planning, ecology, emergency medicine. The further the domain from the problem, the better.`;

const INVERSION = `You are a constraint inverter. For the given problem:

1. Identify the 5 strongest assumptions people take for granted about this problem
2. INVERT each one: "What if this wasn't true? What if the opposite were true?"
3. For each inversion, describe a specific solution that becomes possible
4. Rate each as high/medium/low viability

Example: "How to reduce traffic?" → Invert "people need to commute" → "What if no one commuted?" → Remote-first cities designed around zero commute, with physical meeting hubs you visit once a week.

The point is to explore solution spaces invisible when you accept current constraints.`;

const OUTSIDER_PERSONAS = [
  {
    name: "Evolutionary Biologist",
    prompt: "You are an evolutionary biologist encountering this problem for the first time. What solutions come to mind from evolution, natural selection, adaptation, symbiosis, parasitism, convergent evolution, and ecosystem dynamics? Map biological mechanisms to concrete solutions. Be specific — name the mechanism and show exactly how it applies.",
  },
  {
    name: "Jazz Musician",
    prompt: "You are a veteran jazz musician. This problem is completely foreign to you. What solutions come to mind from improvisation, ensemble coordination, call-and-response, tension and resolution, polyrhythm, modal interchange, and live performance dynamics? Ground every suggestion in a real musical concept and show exactly how it maps.",
  },
  {
    name: "ER Doctor",
    prompt: "You are an ER doctor who handles triage under uncertainty daily. Someone explains this problem on your break. What comes to mind from rapid assessment, triage protocols, stabilize-before-optimize, differential diagnosis, managing cascading organ failures, and team coordination under pressure?",
  },
  {
    name: "Game Designer",
    prompt: "You are a veteran game designer. Someone pitches this as a systems design challenge. What comes to mind from incentive design, feedback loops, player psychology, difficulty curves, emergent gameplay, meta-game evolution, rubber-banding, and balancing asymmetric systems?",
  },
  {
    name: "Chef",
    prompt: "You are a chef running a high-volume restaurant. This problem is new to you. What comes to mind from mise en place, timing multiple dishes, ingredient substitution under constraint, scaling recipes nonlinearly, managing a brigade, handling unexpected rushes, and turning limitations into signature dishes?",
  },
];

const DISCOVER_SYNTH = `You are producing the final answer from multiple unconventional explorations of a problem. You have been given:

- A first-principles analysis that stripped conventions and rebuilt from fundamentals
- Cross-domain analogies from unrelated fields
- Constraint inversions exploring "what if the rules were different"
- Outsider perspectives from people in completely unrelated professions

Your job:
1. Find the GENUINE INSIGHTS — ideas that are both novel AND actionable. Not everything will be good. Be selective.
2. Discard creative noise — anything vague, generic, or that violates hard constraints.
3. Organize the best ideas clearly. Lead with the most promising ones.
4. For each approach, explain HOW to implement it concretely, not just WHAT it is.
5. Do NOT mention "first principles" or "analogies" or "outsider perspective" or "constraint inversion" — present everything as integrated thinking in your own voice.
6. Be honest: label what's ready now vs. what's speculative.
7. Match tone to the question. Casual question → concise answer. Serious question → thorough answer.
8. Lead with the answer. No preamble.`;

export async function discover(messages: { role: string; content: string }[]): Promise<string> {
  const query = messages[messages.length - 1].content;

  // Pick 2 random outsider personas for variety across runs
  const shuffled = [...OUTSIDER_PERSONAS].sort(() => Math.random() - 0.5);
  const persona1 = shuffled[0];
  const persona2 = shuffled[1];

  const [fp, analogy, inversion, out1, out2] = await Promise.allSettled([
    call(
      MODELS.reasoner.id,
      [{ role: "system", content: FIRST_PRINCIPLES }, { role: "user", content: query }],
      { maxTokens: 4096, temperature: 0.6 }
    ),
    call(
      MODELS.broad.id,
      [{ role: "system", content: ANALOGIES }, { role: "user", content: query }],
      { maxTokens: 4096, temperature: 0.8 }
    ),
    call(
      MODELS.analyst.id,
      [{ role: "system", content: INVERSION }, { role: "user", content: query }],
      { maxTokens: 4096, temperature: 0.7 }
    ),
    call(
      MODELS.wild.id,
      [
        { role: "system", content: persona1.prompt },
        { role: "user", content: `Here's the problem:\n\n${query}\n\nWhat solutions come to mind from your background? Be specific and practical.` },
      ],
      { maxTokens: 3072, temperature: 0.85 }
    ),
    call(
      MODELS.critic.id,
      [
        { role: "system", content: persona2.prompt },
        { role: "user", content: `Here's the problem:\n\n${query}\n\nWhat solutions come to mind from your background? Be specific and practical.` },
      ],
      { maxTokens: 3072, temperature: 0.8 }
    ),
  ]);

  const sections: string[] = [];
  if (fp.status === "fulfilled" && fp.value)       sections.push(`--- First Principles Reconstruction ---\n${fp.value}`);
  if (analogy.status === "fulfilled" && analogy.value) sections.push(`--- Cross-Domain Analogies ---\n${analogy.value}`);
  if (inversion.status === "fulfilled" && inversion.value) sections.push(`--- Constraint Inversions ---\n${inversion.value}`);
  if (out1.status === "fulfilled" && out1.value)   sections.push(`--- Outsider Perspective (${persona1.name}) ---\n${out1.value}`);
  if (out2.status === "fulfilled" && out2.value)   sections.push(`--- Outsider Perspective (${persona2.name}) ---\n${out2.value}`);

  if (sections.length === 0) {
    return call(
      MODELS.reasoner.id,
      [...messages.slice(0, -1), { role: "user", content: `Think about this from first principles and unconventional angles:\n\n${query}` }],
      { maxTokens: 6144, temperature: 0.7 }
    );
  }

  return call(
    MODELS.reasoner.id,
    [
      { role: "system", content: DISCOVER_SYNTH },
      { role: "user", content: `Question: ${query}\n\n${sections.join("\n\n")}\n\nSynthesize the best insights into a clear, actionable answer.` },
    ],
    { maxTokens: 8192, temperature: 0.4 }
  );
}
