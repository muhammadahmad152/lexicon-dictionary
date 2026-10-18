'use strict';

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorIcon = document.getElementById('error-icon');
const errorTitle = document.getElementById('error-title');
const errorMessage = document.getElementById('error-message');
const errorTip = document.getElementById('error-tip');

const resultSection = document.getElementById('result-section');
const resultWord = document.getElementById('result-word');
const resultPhonetic = document.getElementById('result-phonetic');
const audioBtn = document.getElementById('audio-btn');

const meaningsContainer = document.getElementById('meanings-container');
const relationsContainer = document.getElementById('relations-container');

const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const WIKTIONARY_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const DATAMUSE_API = 'https://api.datamuse.com/words';

const HISTORY_KEY = 'lexicon_search_history';
const MAX_HISTORY = 10;
const MAX_DEFS = 5;
const MAX_TAGS = 12;
const TIMEOUT = 12000;

let isSearching = false;
let currentAudio = null;

function capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function cleanHTML(html) {
    if (!html) return '';

    const doc = new DOMParser().parseFromString(
        String(html),
        'text/html'
    );

    doc.querySelectorAll('script, style, link, meta, noscript')
        .forEach(element => element.remove());

    return (doc.body.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function setButtonDisabled(disabled) {
    searchBtn.disabled = disabled;
    searchBtn.style.opacity = disabled ? '0.6' : '1';
}

async function fetchJSON(url) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, TIMEOUT);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Word not found.');
            }

            if (response.status === 429) {
                throw new Error('Too many requests. Try again shortly.');
            }

            throw new Error(`API request failed: ${response.status}`);
        }

        return await response.json();

    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please try again.');
        }

        if (error instanceof TypeError) {
            throw new Error('Network error. Check your internet connection.');
        }

        throw error;

    } finally {
        clearTimeout(timer);
    }
}

function normalizeEntries(data, searchedWord) {
    if (!Array.isArray(data)) return [];

    return data.map(entry => ({
        word: entry.word || searchedWord,

        phonetic:
            entry.phonetics?.find(item => item.text)?.text ||
            entry.phonetic ||
            '',

        phonetics: entry.phonetics || [],

        meanings: (entry.meanings || []).map(meaning => ({
            partOfSpeech: meaning.partOfSpeech || 'other',

            definitions: (meaning.definitions || [])
                .map(def => ({
                    definition: cleanHTML(def.definition),
                    example: cleanHTML(def.example || ''),
                    synonyms: def.synonyms || [],
                    antonyms: def.antonyms || []
                }))
                .filter(def => def.definition),

            synonyms: meaning.synonyms || [],
            antonyms: meaning.antonyms || []

        })).filter(meaning => meaning.definitions.length)

    })).filter(entry => entry.meanings.length);
}

async function fetchWiktionary(word) {
    const data = await fetchJSON(
        WIKTIONARY_API + encodeURIComponent(word.toLowerCase())
    );

    const entries = data?.en;

    if (!Array.isArray(entries)) return [];

    const commonTypes = [
        'noun',
        'verb',
        'adjective',
        'adverb',
        'pronoun',
        'preposition',
        'conjunction',
        'interjection',
        'determiner'
    ];

    let meanings = entries.map(entry => ({
        partOfSpeech: entry.partOfSpeech || 'other',

        definitions: (entry.definitions || [])
            .map(def => ({
                definition: cleanHTML(def.definition),

                example: cleanHTML(
                    def.parsedExamples?.[0]?.example ||
                    def.examples?.[0]?.text ||
                    ''
                ),

                synonyms: [],
                antonyms: []
            }))
            .filter(def => def.definition),

        synonyms: [],
        antonyms: []

    })).filter(meaning => meaning.definitions.length);

    const commonMeanings = meanings.filter(meaning =>
        commonTypes.includes(meaning.partOfSpeech.toLowerCase())
    );

    if (commonMeanings.length) {
        meanings = commonMeanings;
    }

    if (!meanings.length) return [];

    return [{
        word: word,
        phonetic: '',
        phonetics: [],
        meanings: meanings
    }];
}

async function fetchWord(word) {
    const query = word.trim();
    let entries = [];

    try {
        const data = await fetchJSON(
            DICTIONARY_API + encodeURIComponent(query)
        );

        entries = normalizeEntries(data, query);

    } catch (error) {
        console.warn(error.message);
        entries = await fetchWiktionary(query);
    }

    if (!entries.length) {
        throw new Error(`No definitions found for "${query}".`);
    }

    const encodedWord = encodeURIComponent(query);

    const [synData, antData] = await Promise.all([
        fetchJSON(
            `${DATAMUSE_API}?rel_syn=${encodedWord}&max=${MAX_TAGS}`
        ).catch(() => []),

        fetchJSON(
            `${DATAMUSE_API}?rel_ant=${encodedWord}&max=${MAX_TAGS}`
        ).catch(() => [])
    ]);

    const synonyms = [
        ...new Set(synData.map(item => item.word).filter(Boolean))
    ];

    const antonyms = [
        ...new Set(antData.map(item => item.word).filter(Boolean))
    ];

    entries[0].meanings.forEach(meaning => {
        meaning.synonyms = [
            ...new Set([...meaning.synonyms, ...synonyms])
        ];

        meaning.antonyms = [
            ...new Set([...meaning.antonyms, ...antonyms])
        ];
    });

    return entries;
}

function hideAll() {
    loadingState.hidden = true;
    errorState.hidden = true;
    resultSection.hidden = true;
}

function showLoading() {
    hideAll();
    loadingState.hidden = false;
    setButtonDisabled(true);
}

function showError(
    message,
    title = 'Dictionary Error',
    icon = '🔍',
    tip = 'Check your spelling and try again.'
) {
    hideAll();

    errorMessage.textContent = message;
    errorTitle.textContent = title;
    errorIcon.textContent = icon;
    errorTip.textContent = tip;

    errorState.hidden = false;
    setButtonDisabled(false);
}

function showResult() {
    hideAll();
    resultSection.hidden = false;
    setButtonDisabled(false);

    resultSection.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

function setupAudioButton(url) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    audioBtn.classList.remove('playing');
    audioBtn.hidden = !url;
    audioBtn.onclick = null;

    if (!url) return;

    audioBtn.onclick = async function () {
        if (currentAudio) {
            currentAudio.pause();
        }

        const audio = new Audio(url);
        currentAudio = audio;

        try {
            await audio.play();
            audioBtn.classList.add('playing');

        } catch (error) {
            console.error(error);
            audioBtn.classList.remove('playing');
        }

        audio.addEventListener('ended', function () {
            if (currentAudio === audio) {
                currentAudio = null;
                audioBtn.classList.remove('playing');
            }
        }, { once: true });
    };
}

function buildMeaningCard(meaning) {
    const card = document.createElement('div');
    card.className = 'meaning-card';

    const pos = document.createElement('span');
    pos.className = 'pos-tag';
    pos.dataset.pos = meaning.partOfSpeech;
    pos.textContent = meaning.partOfSpeech;

    const list = document.createElement('ol');
    list.className = 'definitions-list';
    list.setAttribute('role', 'list');

    meaning.definitions.slice(0, MAX_DEFS).forEach((def, index) => {
        const item = document.createElement('li');
        item.className = 'definition-item';

        const number = document.createElement('span');
        number.className = 'def-number';
        number.setAttribute('aria-hidden', 'true');
        number.textContent = index + 1;

        const body = document.createElement('div');
        body.className = 'def-body';

        const definition = document.createElement('p');
        definition.className = 'def-text';
        definition.textContent = capitalize(cleanHTML(def.definition));

        body.appendChild(definition);

        if (def.example) {
            const example = document.createElement('p');
            example.className = 'def-example';
            example.textContent = cleanHTML(def.example);

            body.appendChild(example);
        }

        item.append(number, body);
        list.appendChild(item);
    });

    card.append(pos, list);

    return card;
}

function buildRelationCard(title, words, type) {
    const card = document.createElement('div');
    card.className = 'relation-card';

    const heading = document.createElement('h3');
    heading.className = `relation-title relation-title--${type}`;
    heading.textContent = title;

    const tags = document.createElement('div');
    tags.className = 'relation-tags';

    words.slice(0, MAX_TAGS).forEach(word => {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = `relation-tag relation-tag--${type}`;
        button.textContent = word;
        button.setAttribute('aria-label', `Search for ${word}`);

        button.addEventListener('click', function () {
            handleSearch(word);
        });

        tags.appendChild(button);
    });

    card.append(heading, tags);

    return card;
}

function renderRelations(synonyms, antonyms) {
    relationsContainer.replaceChildren();

    if (synonyms.length) {
        relationsContainer.appendChild(
            buildRelationCard('Synonyms', synonyms, 'syn')
        );
    }

    if (antonyms.length) {
        relationsContainer.appendChild(
            buildRelationCard('Antonyms', antonyms, 'ant')
        );
    }
}

function renderResult(entries) {
    const entry = entries[0];

    resultWord.textContent = entry.word;
    resultPhonetic.textContent = entry.phonetic || '';

    const audio = entry.phonetics.find(item => item.audio);

    setupAudioButton(audio ? audio.audio : '');

    meaningsContainer.replaceChildren();

    entry.meanings.forEach(meaning => {
        meaningsContainer.appendChild(buildMeaningCard(meaning));
    });

    const synonyms = new Set();
    const antonyms = new Set();

    entry.meanings.forEach(meaning => {
        meaning.synonyms.forEach(word => synonyms.add(word));
        meaning.antonyms.forEach(word => antonyms.add(word));

        meaning.definitions.forEach(def => {
            def.synonyms.forEach(word => synonyms.add(word));
            def.antonyms.forEach(word => antonyms.add(word));
        });
    });

    renderRelations([...synonyms], [...antonyms]);

    showResult();
}

function getHistory() {
    try {
        const history = JSON.parse(
            localStorage.getItem(HISTORY_KEY) || '[]'
        );

        if (Array.isArray(history)) {
            return history.filter(word => typeof word === 'string');
        }

        return [];

    } catch {
        return [];
    }
}

function saveHistory(word) {
    const history = getHistory().filter(
        item => item.toLowerCase() !== word.toLowerCase()
    );

    history.unshift(word);

    try {
        localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify(history.slice(0, MAX_HISTORY))
        );

    } catch (error) {
        console.warn('History could not be saved:', error);
    }

    renderHistory();
}

function clearHistory() {
    try {
        localStorage.removeItem(HISTORY_KEY);

    } catch (error) {
        console.warn('History could not be cleared:', error);
    }

    renderHistory();
}

function renderHistory() {
    const history = getHistory();

    historyList.replaceChildren();
    historySection.hidden = history.length === 0;

    history.forEach(word => {
        const li = document.createElement('li');
        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'history-item';
        button.textContent = word;
        button.setAttribute('aria-label', `Search again: ${word}`);

        button.addEventListener('click', function () {
            handleSearch(word);
        });

        li.appendChild(button);
        historyList.appendChild(li);
    });
}

async function handleSearch(word) {
    const query = String(word ?? searchInput.value).trim();

    if (!query) {
        searchInput.focus();
        searchInput.placeholder = 'Please enter a word first...';
        return;
    }

    if (isSearching) return;

    isSearching = true;
    searchInput.value = query;

    showLoading();

    try {
        const entries = await fetchWord(query);

        renderResult(entries);
        saveHistory(query);

    } catch (error) {
        console.error(error);

        const message = error.message || 'Something went wrong.';

        const connectionError =
            /network|connect|timed out|internet|unavailable/i.test(message);

        showError(
            message,
            connectionError ? 'Connection Error' : 'Word Not Found',
            connectionError ? '📡' : '🔍',
            'Check your connection and spelling, then try again.'
        );

    } finally {
        isSearching = false;
        setButtonDisabled(false);
    }
}

searchBtn.addEventListener('click', function () {
    handleSearch();
});

searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
    }
});

clearHistoryBtn.addEventListener('click', clearHistory);

hideAll();
renderHistory();
setButtonDisabled(false);
