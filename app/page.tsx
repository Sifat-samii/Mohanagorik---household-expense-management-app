import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import FairNestApp from "./fairnest-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="signin-shell">
        <section className="signin-card">
          <div className="brand-mark" aria-hidden="true">M</div>
          <p className="eyebrow">Shared living, simplified</p>
          <h1>Every shared expense.<br />Perfectly clear.</h1>
          <p className="signin-copy">Create a home, invite your people, split anything, and settle up without the awkward maths.</p>
          <a className="signin-button" href={chatGPTSignInPath("/")} target="_top">Sign in to MohaNagorik</a>
          <div className="signin-points" aria-label="Included features">
            <span>Flexible splits</span><span>Private households</span><span>Smart settle-up</span>
          </div>
        </section>
        <section className="signin-preview" aria-hidden="true">
          <div className="preview-balance"><small>Your balance</small><strong>৳2,840</strong><span>you are owed</span></div>
          <div className="preview-row"><b>Groceries</b><span>৳3,260</span></div>
          <div className="preview-row"><b>Electricity</b><span>৳1,480</span></div>
          <div className="preview-row"><b>Internet</b><span>৳1,200</span></div>
        </section>
      </main>
    );
  }

  return <FairNestApp user={{ name: user.displayName, email: user.email }} />;
}
