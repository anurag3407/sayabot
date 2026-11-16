const ITEMS = [
  {
    q: "What if nobody answers?",
    a: "After five minutes the request counts as a no. The tool does not run, the agent is told, and the decision stays on the record. A restart does not leave an old request hanging.",
  },
  {
    q: "Will it ask the same thing twice?",
    a: "An answer is saved as a fact. The next time, the agent reads the fact and skips the question. A fact saved for this room wins over one saved for the whole workspace.",
  },
  {
    q: "Can an agent see my API keys?",
    a: "No. Keys are sealed with AES-256-GCM. The agent sees a placeholder such as $SECRET{STRIPE_KEY}. The real value is swapped in only on the way out, and only for a request you allowed.",
  },
  {
    q: "Where does the work actually run?",
    a: "On your Mac while the app is awake, on Sayabot Cloud with the laptop shut, or on a server you host. The agent, its files and its schedule are the same in all three. Files stay inside /home/bot.",
  },
  {
    q: "Which models can I give it?",
    a: "Any model you bring a key for: Claude, GPT, Gemini, DeepSeek, or a local model through Ollama. The desktop app can also use the Claude Code and Codex subscriptions you already pay for.",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. The same stack is open source under AGPL-3.0. Point it at a machine you control and the chats, agents and files stay there.",
  },
]

export function Faq() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-wrap">
        <div className="faq-head">
          <span className="eyebrow">Questions</span>
          <h2 className="h2" id="faq-title">
            The short version.
          </h2>
          <p className="lede">How the guardrails behave, before you install anything.</p>
        </div>
        <div className="faq-list">
          {ITEMS.map((item) => (
            <details key={item.q} className="faq-item" name="faq">
              <summary>
                <span>{item.q}</span>
                <i aria-hidden />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
