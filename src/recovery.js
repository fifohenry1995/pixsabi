'use strict';
// An optional recovery question. The player picks a question and types an answer; only a hash of the answer is stored,
// so nobody (not even the admin) can read it. If the player cannot use the email reset, the admin asks them the question
// and types what they say into the admin page, which only says "matches" or "does not match".
const { hashPassword, verifyPassword } = require('./util');

const QUESTIONS = [
  { id: 'mother', text: "What is your mother's first name?" },
  { id: 'school', text: 'What primary school did you attend?' },
  { id: 'meal', text: 'What is your favourite meal?' },
  { id: 'town', text: 'In which town or village were you born?' },
  { id: 'friend', text: 'Who was your best friend as a child?' },
  { id: 'phone', text: 'What was your first phone?' },
];
const textOf = (id) => (QUESTIONS.find((q) => q.id === id) || {}).text || '';
// "  Mama  Ngozi! " and "mama ngozi" count as the same answer.
const normalize = (a) => String(a == null ? '' : a).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);

// Returns an error message, or '' when the question and answer are fine.
function problem(qid, answer) {
  if (!QUESTIONS.some((q) => q.id === qid)) return 'Pick one of the questions on the list.';
  if (normalize(answer).length < 3) return 'The answer must have at least 3 letters or numbers.';
  return '';
}
async function set(user, qid, answer) {
  user.recoveryQ = qid;
  user.recoveryHash = await hashPassword(normalize(answer));
}
function clear(user) { user.recoveryQ = ''; user.recoveryHash = ''; }
const has = (u) => !!(u && u.recoveryQ && u.recoveryHash);
async function check(user, answer) {
  if (!has(user)) return false;
  return verifyPassword(normalize(answer), user.recoveryHash);
}
module.exports = { QUESTIONS, textOf, normalize, problem, set, clear, has, check };
