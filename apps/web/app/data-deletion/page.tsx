import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Deletion | Pulse Social Media',
};

export default function DataDeletionPage() {
  return (
    <div className="content doc">
      <h1>Data Deletion</h1>
      <p className="meta">How to delete your data from Kip · Pulse Social Media</p>

      <p>
        You can stop Kip’s access to your social accounts and delete the data we hold. Use both steps
        if you want a full exit.
      </p>

      <h2>1. Disconnect platforms</h2>
      <p>
        <strong>In Kip:</strong> open Connections and disconnect Instagram, Facebook, X, or Threads.
        Tokens are revoked on our side when disconnect completes.
      </p>
      <p>
        <strong>On Meta:</strong> Facebook → Settings &amp; privacy → Settings → Business Integrations
        → find <strong>Pulse AI</strong> → Remove. That immediately revokes Meta access even if you
        skip the in-app button.
      </p>
      <p>
        <strong>On X:</strong> revoke the Pulse / Kip app under X connected apps settings.
      </p>
      <p>
        Disconnect stops future publishing. It does not by itself wipe history stored with us —
        request that below.
      </p>

      <h2>2. Request deletion</h2>
      <p>
        Email <a href="mailto:will@jmcalder.com">will@jmcalder.com</a> from the address or number on
        your account with the subject <strong>“Delete my data”</strong>. We permanently delete (or
        irreversibly anonymise) the data we hold within <strong>30 days</strong> and confirm when
        done.
      </p>

      <h2>What we delete</h2>
      <ul>
        <li>Account and brand profile (name, phone, email).</li>
        <li>OAuth tokens and connected-account identifiers.</li>
        <li>Photos, videos, captions, drafts, schedules, routines, and content plans.</li>
        <li>SMS/MMS history and approval / edit audit trail.</li>
        <li>Memory files and operator notes tied to your brand.</li>
        <li>
          Billing profile links held by us (your payment provider may retain records they need for
          tax/fraud).
        </li>
      </ul>

      <h2>What we cannot delete</h2>
      <ul>
        <li>
          Posts already live on Instagram, Facebook, X, or Threads — remove those on each platform.
        </li>
        <li>
          Copies held briefly by SMS or AI subprocessors under their own retention, subject to our
          deletion instructions.
        </li>
        <li>Minimal records we must keep by law (for example invoice metadata).</li>
      </ul>

      <h2>Export before you go</h2>
      <p>
        Ask for an export of memory files and recent message history in the same deletion email if you
        want a copy first.
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
