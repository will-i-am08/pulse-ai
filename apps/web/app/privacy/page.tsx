import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Pulse Social Media',
};

export default function PrivacyPage() {
  return (
    <div className="content doc">
      <h1>Privacy Policy</h1>
      <p className="meta">Effective 10 September 2026 · Pulse Social Media (“Pulse”, “we”, “us”) · Product: Kip</p>

      <p>
        Kip is an SMS-first organic social agent. You text photos and instructions; Kip drafts captions,
        schedules posts, and publishes to the destinations you connect — after you approve in the
        thread, unless you turn on autopilot. This policy explains what we collect, why, who helps us
        process it, and how you can access or delete it.
      </p>

      <h2>Who this covers</h2>
      <p>
        Brand owners and operators who create a Kip account, connect social destinations, text the
        service number, or use the web dashboard. If you are in Australia, the Australian Privacy
        Principles apply. If you are in the EEA/UK, we process personal data as described below;
        contact us for a DPA if you need one for your organisation.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account &amp; contact:</strong> name, mobile number, and any email you give us. SMS
          one-time codes sign you in.
        </li>
        <li>
          <strong>Brand profile:</strong> brand name, handle notes, tone preferences, and editable
          memory files (for example memory.md) you or an operator save.
        </li>
        <li>
          <strong>Messages &amp; media:</strong> SMS/MMS text, photos, and videos you send so Kip can
          draft and publish; our replies in the same thread.
        </li>
        <li>
          <strong>Drafts, plans &amp; calendar:</strong> captions, scheduled times, content plans,
          routines, and approval / reject history.
        </li>
        <li>
          <strong>Platform connections:</strong> OAuth tokens and account identifiers for Instagram,
          Facebook Pages, X, and Threads you connect, stored encrypted and used only to publish or
          read metrics you request.
        </li>
        <li>
          <strong>Engagement data:</strong> likes, comments, reach and similar metrics from platform
          APIs for check-ins and recaps.
        </li>
        <li>
          <strong>Billing:</strong> plan (Pro / Max), billing period, and payment status via our
          payment processor — we do not store full card numbers.
        </li>
        <li>
          <strong>Operator access:</strong> when Pulse staff or a named operator helps set up your
          brand, their actions on your workspace may be logged (who approved, edited, or connected
          accounts).
        </li>
        <li>
          <strong>Technical logs:</strong> basic server logs (IP, timestamps, error codes) needed to
          run and secure the service.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>Draft captions and replies in your voice from the media and memory you provide.</li>
        <li>Send and receive SMS/MMS on the Kip number.</li>
        <li>Publish approved (or autopilot-authorised) organic posts to connected destinations.</li>
        <li>Run routines you configure (weekly check-in, Friday recap, quiet reminders).</li>
        <li>Show calendar, plan, connections, and memory in the dashboard.</li>
        <li>Bill your plan, prevent abuse, and keep an audit trail of approvals and publishes.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal data or content. We do <strong>not</strong> use
        your photos, captions, or memory files to train our own models, and we contract with AI
        providers on terms that restrict training on your content where those options exist.
      </p>

      <h2>Legal bases (where GDPR applies)</h2>
      <p>
        Contract (providing Kip), legitimate interests (security, product improvement that does not
        require training on your content, fraud prevention), and consent where required (optional
        marketing messages — separate from transactional SMS).
      </p>

      <h2>Processors &amp; destinations</h2>
      <p>We use subprocessors only to deliver Kip:</p>
      <ul>
        <li>
          <strong>Twilio</strong> — SMS/MMS delivery and inbound media.
        </li>
        <li>
          <strong>Meta Platforms</strong> — Instagram, Facebook, and Threads OAuth and publishing via
          Graph APIs.
        </li>
        <li>
          <strong>X Corp.</strong> — X OAuth and publishing.
        </li>
        <li>
          <strong>Anthropic</strong> (and similar LLM providers we may add) — drafting captions and
          summaries from the media and notes you supply.
        </li>
        <li>
          <strong>Neon</strong> — Postgres database and encrypted media storage.
        </li>
        <li>
          <strong>Vercel / Railway</strong> (or equivalent host) — application hosting.
        </li>
        <li>
          <strong>Payment processor</strong> (e.g. Stripe) — subscriptions for Pro / Max.
        </li>
      </ul>
      <p>
        Each processes data only as needed for its function. Platform posts you approve also become
        subject to that platform’s terms and audience.
      </p>

      <h2>Retention &amp; security</h2>
      <p>
        We keep account, message, media, draft, and approval data while your account is active and for
        a reasonable period after (or until you request deletion) so we can support reporting and
        disputes. OAuth tokens are encrypted at rest (AES-256-GCM) and decrypted only server-side at
        use. Traffic uses TLS. Access to operator tools is limited to authorised Pulse staff. Brands
        are isolated from each other in the product data model.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Approve or reject every post in the thread (default), or enable autopilot yourself.</li>
        <li>
          Disconnect Instagram, Facebook, X, or Threads anytime in Connections or via the platform’s
          business integrations settings.
        </li>
        <li>Edit or clear memory files.</li>
        <li>
          Request access, correction, export, or deletion — see{' '}
          <Link href="/data-deletion">Data deletion</Link> or email{' '}
          <a href="mailto:will@jmcalder.com">will@jmcalder.com</a>.
        </li>
        <li>
          Text STOP to pause SMS (transactional notices required by law may still apply).
        </li>
      </ul>

      <h2>Children</h2>
      <p>Kip is for businesses and creators 18+. We do not knowingly collect data from children.</p>

      <h2>Changes</h2>
      <p>
        We will update this page when practices change and revise the effective date. Material changes
        may also be noted in-product or by email/SMS.
      </p>

      <h2>Contact</h2>
      <p>
        Pulse Social Media
        <br />
        Email: <a href="mailto:will@jmcalder.com">will@jmcalder.com</a>
      </p>
    </div>
  );
}
