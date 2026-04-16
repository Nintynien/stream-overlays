const API_BASE = 'https://opentdb.com';

const POINTS_BY_DIFFICULTY = { easy: 1, medium: 2, hard: 3 };
const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Decode HTML entities from OpenTDB responses
 */
function decodeHTML(html) {
  const el = document.createElement('textarea');
  el.innerHTML = html;
  return el.value;
}

/**
 * Fisher-Yates shuffle (in-place)
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Fetch a session token to prevent repeat questions across runs
 */
export async function fetchSessionToken() {
  const res = await fetch(`${API_BASE}/api_token.php?command=request`);
  const data = await res.json();
  if (data.response_code !== 0) {
    throw new Error('Failed to get session token');
  }
  return data.token;
}

/**
 * Reset an exhausted session token
 */
export async function resetSessionToken(token) {
  const res = await fetch(`${API_BASE}/api_token.php?command=reset&token=${token}`);
  const data = await res.json();
  if (data.response_code !== 0) {
    throw new Error('Failed to reset session token');
  }
  return token;
}

/**
 * Fetch and process questions from OpenTDB
 * @param {Object} options
 * @param {number} options.amount - Number of questions
 * @param {string} [options.token] - Session token
 * @param {number} [options.category] - OpenTDB category ID
 * @param {string} [options.difficulty] - easy|medium|hard
 * @param {AbortSignal} [options.signal] - AbortController signal
 * @returns {Promise<Array>} Processed question array
 */
export async function fetchQuestions({ amount, token, category, difficulty, signal }) {
  let url = `${API_BASE}/api.php?amount=${amount}&type=multiple`;
  if (token) url += `&token=${token}`;
  if (category) url += `&category=${category}`;
  if (difficulty && difficulty !== 'mixed') url += `&difficulty=${difficulty}`;

  const res = await fetch(url, { signal });
  const data = await res.json();

  // Handle API response codes
  if (data.response_code === 3) {
    throw new Error('TOKEN_NOT_FOUND');
  }
  if (data.response_code === 4) {
    throw new Error('TOKEN_EXHAUSTED');
  }
  if (data.response_code === 1) {
    throw new Error('NOT_ENOUGH_QUESTIONS');
  }
  if (data.response_code !== 0) {
    throw new Error(`API error: response_code ${data.response_code}`);
  }

  return data.results.map(q => {
    const answers = shuffle([
      decodeHTML(q.correct_answer),
      ...q.incorrect_answers.map(a => decodeHTML(a))
    ]);

    const correctAnswer = decodeHTML(q.correct_answer);
    const correctIndex = answers.indexOf(correctAnswer);

    return {
      text: decodeHTML(q.question),
      category: decodeHTML(q.category),
      difficulty: q.difficulty,
      points: POINTS_BY_DIFFICULTY[q.difficulty] || 1,
      answers,
      correctIndex,
      correctLetter: LETTERS[correctIndex],
    };
  });
}
