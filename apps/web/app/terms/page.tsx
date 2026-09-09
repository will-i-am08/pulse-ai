import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Pulse Social Media',
};

export default function TermsPage() {
  return (
    <div className="content doc">
      <h1>Terms of Service</h1>
      <p className="meta">Effective 1 September 2026</p>

      <p>
        These Terms govern your use of Kip, a social media assistant operated by Pulse Social Media
        ("Pulse", "we", "us"). By creating an account or connecting your Instagram or Facebook account,
        you agree to these Terms.
      </p>

      <h2>The service</h2>
      <p>
        Kip helps you create and publish social media content. You send us a photo, we draft an
        on-brand caption, you approve it, and (for accounts you have connected) we publish it to your
        Instagram and/or Facebook Page on your behalf. You approve content before it is published,
        except where you have explicitly enabled automatic (&ldquo;autopilot&rdquo;) posting for a
        content type, which you can pause at any time.
      </p>

      <h2>Your accounts and connections</h2>
      <ul>
        <li>
          You must own, or be authorised to manage, any Instagram or Facebook account you connect to
          Kip.
        </li>
        <li>
          You grant Kip permission to publish content you have approved to those connected accounts,
          and to read the information needed to do so (your Pages, linked Instagram account, and post
          engagement).
        </li>
        <li>You are responsible for keeping your login credentials secure.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You retain ownership of the photos, captions, and other content you provide. You grant Kip a
        limited licence to store, process, adapt (for example, styling a photo or generating a caption),
        and publish that content solely to deliver the service. You are responsible for ensuring you
        have the rights to the content you send us.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You agree not to use Kip to publish unlawful, infringing, deceptive, or harmful content, or to
        violate the terms or policies of Instagram, Facebook, or Meta. We may suspend or terminate
        accounts that do so.
      </p>

      <h2>Third-party platforms</h2>
      <p>
        Publishing depends on Meta&apos;s platforms and APIs, which are outside our control. We are not
        responsible for platform outages, policy changes, or actions Meta takes on your accounts. Your
        use of Instagram and Facebook remains subject to Meta&apos;s own terms.
      </p>

      <h2>Disclaimers &amp; liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;. To the extent permitted by law, Pulse is not liable
        for indirect or consequential losses, or for content published after your approval or under an
        autopilot setting you enabled.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using Kip and disconnect your accounts at any time. You can revoke Kip&apos;s
        access to your Meta accounts from your Facebook settings (Settings &rarr; Business Integrations).
        On request we will delete the data we hold about you. See our{' '}
        <a href="/data-deletion">Data Deletion</a> page.
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
