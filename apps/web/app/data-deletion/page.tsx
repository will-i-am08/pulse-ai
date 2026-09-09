import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Deletion | Pulse Social Media',
};

export default function DataDeletionPage() {
  return (
    <div className="content doc">
      <h1>Data Deletion</h1>
      <p className="meta">How to delete your data from Kip</p>

      <p>
        You can have the data Kip holds about you deleted at any time. This page explains what we
        store and how to request its removal.
      </p>

      <h2>Disconnect Kip from Meta</h2>
      <p>
        To immediately revoke Kip&apos;s access to your Instagram and Facebook accounts, remove the
        integration from your Facebook settings:
      </p>
      <ul>
        <li>
          Go to <strong>Facebook &rarr; Settings &amp; privacy &rarr; Settings &rarr; Business
          Integrations</strong>.
        </li>
        <li>
          Find <strong>Pulse AI</strong> in the list and select <strong>Remove</strong>.
        </li>
      </ul>
      <p>
        This stops all future access and publishing. It does not, on its own, delete the data already
        stored with us. Request that below.
      </p>

      <h2>Request deletion of your data</h2>
      <p>
        Email <a href="mailto:will@jmcalder.com">will@jmcalder.com</a> from the address on your account
        with the subject <strong>&ldquo;Delete my data&rdquo;</strong>. We will permanently delete the
        data we hold about you within <strong>30 days</strong> and confirm once it is done.
      </p>

      <h2>What gets deleted</h2>
      <ul>
        <li>Your account and brand profile (name, email, phone number).</li>
        <li>Your connected-account identifiers and stored access tokens.</li>
        <li>Photos, captions, drafts, scheduled posts, and campaign plans.</li>
        <li>Message history and the approval/edit audit trail.</li>
      </ul>
      <p>
        Content already published to your own Instagram or Facebook is not affected. You control that
        from those platforms directly. We may retain minimal records where required by law.
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
