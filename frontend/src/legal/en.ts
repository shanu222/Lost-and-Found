import type { LegalDocs } from './types';

const en: LegalDocs = {
  updated: 'Last updated: 19 November 2026',
  contactLabel: 'Contact',
  back: 'Back',
  terms: {
    title: 'Terms of Use',
    intro:
      'These terms explain how FoundBack works and what we expect from everyone who uses it. FoundBack is operated by Resilience Technologies Labs (SMC-Private) Limited, Islamabad, Pakistan ("we", "us"). By creating an account or using FoundBack you agree to these terms.',
    sections: [
      {
        h: 'What FoundBack is',
        p: [
          'FoundBack helps people who find lost items return them to their owners. Finders post what they found; owners prove ownership by answering hidden questions and sharing proof; the two then arrange a handover.',
          'We provide the platform only. We do not hold, inspect, collect or deliver items, and we are not a party to any handover between users.',
        ],
      },
      {
        h: 'Your account',
        p: [
          'You sign in with Google or with an email address and password. You must give accurate information, keep your sign-in details private and tell us if you think your account has been misused.',
          'You must be at least 13 years old, or the minimum age to use online services in your country if that is higher. One person, one account.',
        ],
      },
      {
        h: 'Your country',
        p: [
          'FoundBack is organised by country. Your country is set from your device\'s live location, and some actions ask you to confirm your location again. Using a VPN, proxy, location spoofing or any other method to appear in a different country is not allowed and may lead to your account being restricted.',
        ],
      },
      {
        h: 'Posting found items and lost reports',
        p: [
          'Only post items you have actually found or lost. Describe them honestly, use your own photos and keep identifying details (ID numbers, serial numbers, card details) for the hidden questions — never in public text or photos.',
          'Do not post illegal goods, weapons, drugs, animals for sale, advertising, or anything that is not a genuine lost or found item. Photos of identity documents, bank cards, documents and cash are kept private automatically.',
        ],
      },
      {
        h: 'Claims and ownership',
        p: [
          'Only claim items that belong to you. Claiming someone else\'s property, giving false proof or using another person\'s identity is fraud: we will close the account and may report it to the authorities.',
          'The finder decides whether a claim is convincing. FoundBack does not guarantee that a claimant is the true owner, or that a finder still has the item.',
        ],
      },
      {
        h: 'Handover and safety',
        p: [
          'Meet in a busy public place, during the day if possible, or hand the item to the police or a lost-property office. Never pay money, share bank details or send codes to anyone you meet through FoundBack. Use the handover code to confirm the right person receives the item.',
          'If an item is valuable, an official document or you feel unsafe, involve the police. You are responsible for your own safety and for following local laws on found property.',
        ],
      },
      {
        h: 'Rewards',
        p: [
          'Owners may thank finders however they choose, but no one may demand payment or a reward as a condition of returning an item.',
        ],
      },
      {
        h: 'Messages and conduct',
        p: [
          'Be respectful. Harassment, threats, hate speech, spam, scams and attempts to move people off FoundBack to defraud them are not allowed. Phone numbers and links in messages may be hidden to protect users.',
        ],
      },
      {
        h: 'Moderation',
        p: [
          'Our team and country moderators may review reported content, remove posts, cancel claims, and suspend or close accounts that break these terms or put others at risk. You can report any post, claim or user from the app.',
        ],
      },
      {
        h: 'Your content',
        p: [
          'You keep ownership of what you post. You give us permission to store, display, translate and process it so FoundBack can work, for as long as it remains on the platform.',
        ],
      },
      {
        h: 'Availability and liability',
        p: [
          'We work to keep FoundBack running and secure, but we provide it "as is" and cannot promise it will always be available or error-free. To the extent the law allows, we are not liable for lost, damaged or wrongly returned items, for what users do, or for indirect losses. Nothing in these terms limits rights you have under the law that cannot be limited.',
        ],
      },
      {
        h: 'Ending your account',
        p: [
          'You can delete your account at any time in Settings. We may suspend or close accounts that break these terms.',
        ],
      },
      {
        h: 'Changes and law',
        p: [
          'We may update these terms; if the changes are significant we will tell you in the app. These terms are governed by the laws of Pakistan, and disputes are subject to the courts of Islamabad, unless the law of your country gives you other rights.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    intro:
      'This policy explains what personal data FoundBack collects, why, who processes it and the choices you have. The controller is Resilience Technologies Labs (SMC-Private) Limited, Islamabad, Pakistan.',
    sections: [
      {
        h: 'What we collect',
        p: [
          'Account: your email address, your name and profile picture if you use Google, your language and app settings.',
          'Location: your device\'s live position when you confirm your country or post and claim (used to decide your country, not to track you), the country of your internet connection to detect VPNs and proxies, and the city and optional home area you choose.',
          'Content: items you post or report, photos, hidden questions and answers, claims and proof, messages, ratings and reports. Identity photos you upload for verification.',
          'Technical: sign-in and security records (for example IP address, device and time), and push-notification tokens if you turn notifications on.',
        ],
      },
      {
        h: 'How we use it',
        p: [
          'To run the service: show items in your country, match lost reports with found items, handle claims and handovers, send notifications and translate posts.',
          'To keep people safe: verify ownership, prevent fraud, enforce the one-country rule, moderate content and respond to reports.',
          'We do not sell your personal data and we do not show advertising based on it.',
        ],
      },
      {
        h: 'What other users see',
        p: [
          'Other users see your public posts, your display name and your trust level. Your email address, exact location, ID numbers, hidden answers and proof are never public. Finders see a claim\'s proof only for their own item, and emails are shared at handover only if both people agree.',
        ],
      },
      {
        h: 'Protection',
        p: [
          'Data is sent over encrypted connections. ID numbers, serial numbers, hidden answers and service keys are encrypted at rest, and photos are stored privately and shown only through short-lived links. Access by our staff is limited and logged.',
        ],
      },
      {
        h: 'Service providers',
        p: [
          'We use trusted providers to run FoundBack: Google Firebase (sign-in), Railway (servers and database), Cloudflare R2 (photo storage), Resend (email), OpenStreetMap / Nominatim (maps and addresses), and AI providers — OpenAI, Google Gemini and OpenRouter — for translating posts and checking photos for unsafe content. Hidden answers and proof are never sent to AI providers. These providers may process data outside your country under appropriate safeguards.',
        ],
      },
      {
        h: 'How long we keep it',
        p: [
          'Posts, claims and messages are kept while they are needed and then expire or are archived. Identity photos are deleted after review. When you delete your account, your profile and open posts are removed and personal details are erased; limited records may be kept where the law or fraud prevention requires.',
        ],
      },
      {
        h: 'Your choices and rights',
        p: [
          'In Settings you can change your details, turn notifications off, download a copy of your data and delete your account. You can also ask us to access, correct or delete your data, or object to how we use it, by emailing us.',
        ],
      },
      {
        h: 'Children',
        p: ['FoundBack is not intended for children under 13, and we do not knowingly collect their data.'],
      },
      {
        h: 'Changes',
        p: ['If we change this policy in an important way, we will tell you in the app before the change applies.'],
      },
    ],
  },
};

export default en;
