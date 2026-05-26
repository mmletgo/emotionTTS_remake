import re

COMMON_ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.",
    "st.", "mt.", "no.",
    "etc.", "e.g.", "i.e.", "vs.",
    "fig.", "al.", "inc.", "ltd.", "co.",
    "u.s.", "u.k.", "u.n.",
    "a.m.", "p.m.", "ph.d."
}


def is_decimal_point(text: str, idx: int) -> bool:
    if idx < 0 or idx >= len(text) or text[idx] != '.': return False
    prev_char = text[idx - 1] if idx - 1 >= 0 else ''
    next_char = text[idx + 1] if idx + 1 < len(text) else ''
    return prev_char.isdigit() and next_char.isdigit()


def get_word_before_index(text: str, idx: int, max_lookback: int = 20) -> str:
    left = max(0, idx - max_lookback)
    snippet = text[left:idx + 1]
    m = re.search(r'([A-Za-z][A-Za-z\.]{0,20}\.)$', snippet)
    return m.group(1).lower() if m else ""


def is_abbreviation_at_dot(text: str, idx: int) -> bool:
    if idx < 0 or idx >= len(text) or text[idx] != '.': return False
    if is_decimal_point(text, idx): return True
    word = get_word_before_index(text, idx)
    if word in COMMON_ABBREVIATIONS: return True
    left = max(0, idx - 10)
    snippet = text[left:idx + 2]
    if re.search(r'(?:\b[A-Za-z]\.){2,}$', snippet[:-1]): return True
    prev_char = text[idx - 1] if idx - 1 >= 0 else ''
    if prev_char.isalpha():
        prev_prev = text[idx - 2] if idx - 2 >= 0 else ' '
        if not prev_prev.isalpha(): return True
    return False


def consume_closing_quotes_brackets(text: str, idx: int) -> int:
    closing_chars = set(['"', "'", '”', '’', ')', ']', '}'])
    n = len(text)
    j = idx + 1
    while j < n and text[j] in closing_chars:
        j += 1
    return j


def find_best_cut_in_long_sentence(text: str, start: int, max_len: int) -> int:
    end = min(start + max_len, len(text))
    if end >= len(text): return len(text)
    chunk = text[start:end]
    # 优先级 1：分号、冒号、中文逗号
    for i in range(len(chunk) - 1, -1, -1):
        if chunk[i] in [';', ':', '；', '：', '，', ',']:
            return start + i + 1
    # 优先级 2：连字符、破折号、括号等
    for i in range(len(chunk) - 1, -1, -1):
        if chunk[i] in ['-', ')', ']', '}']:
            return start + i + 1
    # 优先级 3：空格 (避免切断英文单词)
    for i in range(len(chunk) - 1, -1, -1):
        if chunk[i].isspace():
            return start + i + 1
    return end


def split_long_sentence(sentence: str, max_len: int):
    sentence = sentence.strip()
    if not sentence: return []
    if len(sentence) <= max_len: return [sentence]
    parts = []
    start = 0
    n = len(sentence)
    while start < n:
        cut = find_best_cut_in_long_sentence(sentence, start, max_len)
        if cut <= start: cut = min(start + max_len, n)
        part = sentence[start:cut].strip()
        if part: parts.append(part)
        start = cut
        while start < n and sentence[start].isspace(): start += 1
    return parts


def smart_split_text(text: str, min_len: int = 10, max_len: int = 150):
    if not text or not text.strip(): return []

    sentences = []
    start = 0
    i = 0
    n = len(text)

    split_chars = set(['。', '！', '？', '!', '?', '；', ';', '\n'])

    while i < n:
        ch = text[i]
        is_break = False
        if ch in split_chars:
            is_break = True
        elif ch == '.':
            if not is_abbreviation_at_dot(text, i):
                is_break = True

        if is_break:
            end = consume_closing_quotes_brackets(text, i)
            sentences.append(text[start:end])
            start = end
            i = end - 1
        i += 1

    tail = text[start:]
    if tail.strip():
        sentences.append(tail)

    combined_sentences = []
    current_buffer = ""
    for i, sent in enumerate(sentences):
        current_buffer += sent
        clean_txt = current_buffer.replace('\n', '').replace('\r', '').strip()
        if len(clean_txt) >= min_len or i == len(sentences) - 1:
            if clean_txt:
                combined_sentences.append(clean_txt)
            current_buffer = ""

    final_blocks = []
    for sent in combined_sentences:
        if len(sent) > max_len:
            final_blocks.extend(split_long_sentence(sent, max_len))
        else:
            final_blocks.append(sent)

    return final_blocks