import { tidy, type BookInput } from '../board/board';
import { requestBookPrompt } from '../integrations/chromeAi/prompt';

const instructions = `Extract search-ready book titles and author names, not complete bibliographic descriptions.
Use the shortest faithful title that still identifies the intended book,
using the supplied author for disambiguation when available.
Prefer the intact main title over a selection of keywords.

Remove list markers, surrounding quotation marks, retailer/review text,
format and edition annotations, and marketing suffixes such as ": A Novel".
Omit a subtitle when the main title and supplied author are sufficient.
Retain subtitle wording when needed to distinguish the intended book.

Remove appended series labels only when redundant. Preserve numbers,
volume identifiers, and title wording needed to distinguish different books.
Do not remove text solely because it follows a colon, dash, or opening parenthesis. 
Remove it only when it is unnecessary to identify the intended book.

Preserve the retained wording, punctuation, accents, and original language.
Do not translate, paraphrase, invent abbreviations, or correct titles from memory.
When uncertain whether wording is essential, retain it.

Extract the supplied author name, removing labels and honorifics.
Preserve initials, accents, and name order; do not expand initials,
reduce names to surnames, or guess missing authors.
Use an empty author string when absent or ambiguously associated.`;

const schema = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, author: { type: 'string' } },
        required: ['title', 'author'],
        additionalProperties: false,
      },
    },
  },
  required: ['books'],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBookInput(value: unknown): value is BookInput {
  return isRecord(value) && typeof value.title === 'string' && !!tidy(value.title) && typeof value.author === 'string';
}

function parseBooks(response: string): BookInput[] {
  let result: unknown;
  try {
    result = JSON.parse(response);
  } catch {
    throw new Error('Chrome AI returned invalid JSON. Your text has been kept; please try again.');
  }
  if (!isRecord(result) || !Array.isArray(result.books) || !result.books.every(isBookInput)) {
    throw new Error('Chrome AI returned invalid book details. Your text has been kept; please try again.');
  }
  if (!result.books.length) throw new Error('No books could be identified. Include book titles and any known authors, then try again.');
  return result.books.map((book) => ({ title: tidy(book.title), author: tidy(book.author) }));
}

export async function extractBooks(
  text: string,
  onStatus: (status: string) => void,
  signal: AbortSignal,
): Promise<BookInput[]> {
  if (!text.trim()) throw new Error('Enter at least one book title.');
  const response = await requestBookPrompt(text, instructions, schema, onStatus, signal,
    'Extracting and normalizing books with Chrome AI...');
  return parseBooks(response);
}
