/**
 * Fictional, synthetic contract language used to build the test fixtures.
 *
 * None of this is copied from a real commercial agreement. The parties,
 * addresses, amounts, and clause wording are invented so the fixtures can be
 * committed safely. Do not treat any of it as legal drafting.
 */

export interface Section {
  heading: string;
  paragraphs: string[];
}

export const CLEAN_TITLE = "MASTER SERVICES AGREEMENT";

export const CLEAN_SECTIONS: Section[] = [
  {
    heading: "1. PARTIES AND EFFECTIVE DATE",
    paragraphs: [
      'This Master Services Agreement (the "Agreement") is entered into as of March 14, 2024 ' +
        '(the "Effective Date") by and between Northwind Analytics, LLC, a fictional limited ' +
        'liability company with offices at 4120 Sample Way, Testville, Ohio ("Provider"), and ' +
        'Blue Harbor Logistics, Inc., a fictional corporation with offices at 88 Placeholder ' +
        'Avenue, Testville, Ohio ("Customer").',
      'Provider and Customer are each referred to as a "Party" and collectively as the ' +
        '"Parties". This document is synthetic sample text created only for software testing.',
    ],
  },
  {
    heading: "2. SCOPE OF SERVICES",
    paragraphs: [
      "Provider shall perform the analytics and reporting services described in one or more " +
        'mutually executed statements of work (each, an "SOW"). Each SOW shall reference this ' +
        "Agreement and shall describe the deliverables, acceptance criteria, and fees " +
        "applicable to that engagement.",
      "In the event of a conflict between this Agreement and an SOW, this Agreement controls " +
        "unless the SOW expressly states that it supersedes a specific numbered section of " +
        "this Agreement.",
    ],
  },
  {
    heading: "3. FEES AND PAYMENT",
    paragraphs: [
      "Customer shall pay Provider the fees stated in the applicable SOW. Unless an SOW states " +
        "otherwise, Provider shall invoice monthly in arrears and Customer shall pay each " +
        "undisputed invoice within thirty (30) days of receipt.",
      "Late amounts accrue interest at the lesser of one percent (1%) per month or the maximum " +
        "rate permitted by applicable law. Fees are exclusive of taxes, and Customer is " +
        "responsible for applicable sales and use taxes other than taxes on Provider's net " +
        "income.",
    ],
  },
  {
    heading: "4. TERM AND TERMINATION",
    paragraphs: [
      "The initial term of this Agreement is twenty-four (24) months from the Effective Date " +
        "and renews for successive twelve (12) month periods unless either Party gives written " +
        "notice of non-renewal at least sixty (60) days before the end of the then-current term.",
      "Either Party may terminate this Agreement for material breach if the breaching Party " +
        "fails to cure the breach within thirty (30) days after written notice describing the " +
        "breach in reasonable detail.",
    ],
  },
  {
    heading: "5. CONFIDENTIALITY",
    paragraphs: [
      "Each Party shall protect the other Party's Confidential Information using at least the " +
        "degree of care it uses to protect its own confidential information of similar " +
        "importance, and in no event less than reasonable care.",
      "Confidential Information does not include information that is or becomes publicly " +
        "available without breach of this Agreement, was known to the receiving Party without " +
        "restriction before disclosure, or is independently developed without use of the " +
        "disclosing Party's Confidential Information.",
    ],
  },
  {
    heading: "6. LIMITATION OF LIABILITY",
    paragraphs: [
      "Except for a Party's indemnification obligations and breaches of confidentiality, " +
        "neither Party is liable for indirect, incidental, special, consequential, or punitive " +
        "damages, even if advised of the possibility of such damages.",
      "Each Party's aggregate liability arising out of or related to this Agreement shall not " +
        "exceed the total fees paid or payable by Customer under the applicable SOW during the " +
        "twelve (12) months preceding the event giving rise to the claim.",
    ],
  },
  {
    heading: "7. GOVERNING LAW AND NOTICES",
    paragraphs: [
      "This Agreement is governed by the laws of the State of Ohio without regard to its " +
        "conflict of laws principles. The Parties consent to the exclusive jurisdiction of the " +
        "state and federal courts located in Testville, Ohio.",
      "Notices must be in writing and are effective upon receipt when delivered to the " +
        "addresses listed in Section 1 or to such other address as a Party designates in " +
        "writing.",
    ],
  },
  {
    heading: "8. ENTIRE AGREEMENT",
    paragraphs: [
      "This Agreement, together with all SOWs, constitutes the entire agreement between the " +
        "Parties regarding its subject matter and supersedes all prior proposals and " +
        "understandings, whether written or oral.",
      "No amendment is effective unless in writing and signed by an authorized representative " +
        "of each Party. This sample document ends here.",
    ],
  },
];

export const MULTICOLUMN_TITLE = "SUPPLEMENTAL TERMS - TWO COLUMN FORMAT";

/**
 * Four column blocks. Page 1 holds blocks A and B, page 2 holds C and D.
 * Correct human reading order is left column first, then right column.
 */
export const MULTICOLUMN_BLOCKS: Section[] = [
  {
    heading: "A. DEFINITIONS",
    paragraphs: [
      '"Authorized User" means an employee or contractor of Customer permitted to access the ' +
        "Services under the applicable SOW.",
      '"Deliverable" means any report, dataset, model artifact, or documentation identified as ' +
        "a deliverable in an SOW.",
      '"Service Window" means the recurring maintenance period from 02:00 to 05:00 Eastern ' +
        "Time each Sunday.",
    ],
  },
  {
    heading: "B. SERVICE LEVELS",
    paragraphs: [
      "Provider targets monthly availability of ninety-nine and five tenths percent (99.5%) " +
        "measured outside the Service Window.",
      "If availability falls below the target in two consecutive months, Customer may request " +
        "a service credit equal to five percent (5%) of the monthly fee.",
      "Service credits are the sole remedy for availability shortfalls and must be requested " +
        "within thirty (30) days of the affected month.",
    ],
  },
  {
    heading: "C. DATA HANDLING",
    paragraphs: [
      "Provider shall process Customer data only to deliver the Services and shall not sell or " +
        "share that data with unaffiliated third parties.",
      "Provider shall delete or return Customer data within sixty (60) days after termination, " +
        "except for copies retained in routine backups.",
      "Customer remains responsible for the accuracy and lawfulness of the data it submits to " +
        "the Services.",
    ],
  },
  {
    heading: "D. CHANGE CONTROL",
    paragraphs: [
      "Either Party may propose a change to an SOW by submitting a written change request " +
        "describing the scope and fee impact.",
      "A change request becomes binding only when signed by both Parties. Work continues under " +
        "the existing SOW until then.",
      "This two column sample exists to test whether an extractor reads each column in order " +
        "or interleaves the lines across the page.",
    ],
  },
];

/** Lines rendered into the raster image of the scanned fixture. */
export const SCANNED_LINES: string[] = [
  "ADDENDUM ONE TO MASTER SERVICES AGREEMENT",
  "",
  "This Addendum is entered into as of April 2, 2024 between",
  "Northwind Analytics, LLC and Blue Harbor Logistics, Inc.",
  "",
  "1. The monthly service fee is increased to four thousand",
  "two hundred dollars ($4,200) beginning May 1, 2024.",
  "",
  "2. Provider shall deliver one additional quarterly report",
  "summarizing shipment exception rates by region.",
  "",
  "3. All other terms of the Agreement remain unchanged.",
  "",
  "This page was produced as a raster image on purpose so",
  "that text extraction returns no characters without OCR.",
];
