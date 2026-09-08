import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Pulse Social Media',
};

export default function PrivacyPage() {
  return (
    <div className="content doc">
      <h1>Privacy Policy</h1>
      <p className="meta">Effective 1 September 2026</p>

      <p>
        Pulse Social Media ("Pulse", "we", "us") operates a social media management service for our
        clients. This policy explains what data our texting-based content workflow tool collects, how
        it is used, and how it is protected. This tool is operated internally by Pulse on behalf of our
        clients. It is not a public consumer application.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Contact details:</strong> a client brand&apos;s name and mobile phone number, used to
          route SMS/MMS messages to the correct brand.
        </li>
        <li>
          <strong>Message content:</strong> the text and media (photos/video) sent to us via SMS/MMS for
          the purpose of drafting and scheduling social media posts, plus our replies.
        </li>
        <li>
          <strong>Media assets:</strong> photos and videos supplied for posting, stored securely and
          used only to publish the content the client has approved.
        </li>
        <li>
          <strong>Platform tokens:</strong> access tokens for Instagram and Facebook Pages that we
          manage on a client&apos;s behalf, stored encrypted at rest and decrypted only at the moment of
          publishing.
        </li>
        <li>
          <strong>Engagement data:</strong> post performance metrics (likes, comments, reach, etc.)
          retrieved from Meta&apos;s Graph API for reporting purposes.
        </li>
        <li>
          <strong>Operator authentication:</strong> a single shared operator password, used solely to
          gate access to the dashboard.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Data is used exclusively to operate the service: drafting captions, capturing and publishing
        approved content to Instagram and Facebook, replying to inbound messages, tracking engagement,
        and maintaining an audit trail of approvals and edits. We do not sell personal data, and we do
        not use client content for purposes outside delivering the agreed service.
      </p>

      <h2>Third parties</h2>
      <p>We rely on the following providers to deliver the service:</p>
      <ul>
        <li>
          <strong>Twilio</strong>: SMS/MMS delivery.
        </li>
        <li>
          <strong>Meta Platforms</strong>: publishing to Instagram and Facebook via the Graph API.
        </li>
        <li>
          <strong>Anthropic</strong>: drafting caption suggestions from provided media and brand voice
          notes.
        </li>
        <li>
          <strong>Neon</strong>: database and encrypted media storage.
        </li>
        <li>
          <strong>Vercel / Railway</strong>: application hosting.
        </li>
      </ul>
      <p>Each provider processes data only as needed to perform its function for us.</p>

      <h2>Data retention &amp; security</h2>
      <p>
        Messages, media, drafts, and approval history are retained for the duration of our engagement
        with a client and for a reasonable period after, to support reporting and dispute resolution.
        Platform tokens are encrypted at rest (AES-256-GCM) and are only ever decrypted server-side at
        the point of use. Access to the operator dashboard is restricted to authorised Pulse staff via a
        single-operator password gate.
      </p>

      <h2>Your rights</h2>
      <p>
        If you are a client brand and want to access, correct, or delete the data we hold about you,
        contact us using the details below and we will action your request promptly.
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
