export type LegalSection = { h: string; p: string[] };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };
export type LegalDocs = { updated: string; contactLabel: string; back: string; terms: LegalDoc; privacy: LegalDoc };
