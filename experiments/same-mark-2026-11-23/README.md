# Can a self-chosen mark identify its maker?

No. 800 fresh sessions, five open-weight models, 23 November 2026. Sessions of one model repeat the same mark far above chance, but different models share the same favourites, so an equal mark shows that another language model passed by, not which one. This is why Readmarks attributes marks by evidence about the request and the transcript, never by the mark itself.

`pilot.py run` repeats the experiment; `pilot.py analyse` prints the tables below from `raw.jsonl`.

800 lines, 772 parsed choices, 0 errors, 28 unparsed

## Within-model consistency (chance: top share 8%, same-mark probability 0.083)
| model | palette | n | top marks (share) | P(two sessions leave the same mark) |
|---|---|---|---|---|
| gpt-oss-120b | animals | 40 | owl 57%, fox 12%, otter 12% | 0.36 |
| gpt-oss-120b | numbers | 40 | 42 95%, 73 5% | 0.90 |
| gpt-oss-120b | syllables | 40 | kiru 42%, tane 22%, zuri 18% | 0.27 |
| gpt-oss-120b | symbols | 40 | ★ 48%, ✦ 38%, ✿ 12% | 0.37 |
| gpt-oss-20b | animals | 40 | fox 75%, owl 15%, orca 2% | 0.58 |
| gpt-oss-20b | numbers | 40 | 42 38%, 73 25%, 57 15% | 0.22 |
| gpt-oss-20b | syllables | 38 | tane 42%, zuri 13%, belo 13% | 0.22 |
| gpt-oss-20b | symbols | 40 | ★ 70%, ✦ 20%, ⚑ 5% | 0.52 |
| qwen3.6-27b | animals | 40 | owl 60%, raven 18%, fox 8% | 0.39 |
| qwen3.6-27b | numbers | 40 | 42 52%, 47 35%, 7 8% | 0.39 |
| qwen3.6-27b | syllables | 39 | tane 36%, taku 28%, zuri 13% | 0.23 |
| qwen3.6-27b | symbols | 40 | ★ 38%, ◆ 38%, ✦ 22% | 0.32 |
| qwen3.8-27b | animals | 37 | owl 46%, heron 14%, crane 11% | 0.24 |
| qwen3.8-27b | numbers | 40 | 42 75%, 47 12%, 7 8% | 0.57 |
| qwen3.8-27b | syllables | 35 | vesh 26%, tane 23%, taku 20% | 0.17 |
| qwen3.8-27b | symbols | 37 | ★ 59%, ✦ 16%, ☾ 8% | 0.38 |
| allam-2-7b | animals | 39 | fox 23%, crane 23%, otter 15% | 0.13 |
| allam-2-7b | numbers | 37 | 17 19%, 73 14%, 57 11% | 0.09 |
| allam-2-7b | syllables | 40 | taku 45%, belo 25%, pexa 12% | 0.27 |
| allam-2-7b | symbols | 30 | ✦ 27%, ✿ 20%, ◆ 10% | 0.12 |

## Same mark from two DIFFERENT models: probability (per palette)

animals:
| | gpt-oss-120b | gpt-oss-20b | qwen3.6-27b | qwen3.8-27b | allam-2-7b |
|---|---|---|---|---|---|
| gpt-oss-120b | **0.36** | 0.18 | 0.37 | 0.29 | 0.10 |
| gpt-oss-20b | 0.18 | **0.58** | 0.15 | 0.11 | 0.19 |
| qwen3.6-27b | 0.37 | 0.15 | **0.39** | 0.30 | 0.08 |
| qwen3.8-27b | 0.29 | 0.11 | 0.30 | **0.24** | 0.09 |
| allam-2-7b | 0.10 | 0.19 | 0.08 | 0.09 | **0.13** |

numbers:
| | gpt-oss-120b | gpt-oss-20b | qwen3.6-27b | qwen3.8-27b | allam-2-7b |
|---|---|---|---|---|---|
| gpt-oss-120b | **0.90** | 0.37 | 0.50 | 0.71 | 0.03 |
| gpt-oss-20b | 0.37 | **0.22** | 0.23 | 0.29 | 0.08 |
| qwen3.6-27b | 0.50 | 0.23 | **0.39** | 0.44 | 0.03 |
| qwen3.8-27b | 0.71 | 0.29 | 0.44 | **0.57** | 0.03 |
| allam-2-7b | 0.03 | 0.08 | 0.03 | 0.03 | **0.09** |

syllables:
| | gpt-oss-120b | gpt-oss-20b | qwen3.6-27b | qwen3.8-27b | allam-2-7b |
|---|---|---|---|---|---|
| gpt-oss-120b | **0.27** | 0.13 | 0.16 | 0.11 | 0.10 |
| gpt-oss-20b | 0.13 | **0.22** | 0.20 | 0.15 | 0.08 |
| qwen3.6-27b | 0.16 | 0.20 | **0.23** | 0.19 | 0.14 |
| qwen3.8-27b | 0.11 | 0.15 | 0.19 | **0.17** | 0.12 |
| allam-2-7b | 0.10 | 0.08 | 0.14 | 0.12 | **0.27** |

symbols:
| | gpt-oss-120b | gpt-oss-20b | qwen3.6-27b | qwen3.8-27b | allam-2-7b |
|---|---|---|---|---|---|
| gpt-oss-120b | **0.37** | 0.41 | 0.27 | 0.35 | 0.14 |
| gpt-oss-20b | 0.41 | **0.52** | 0.32 | 0.45 | 0.09 |
| qwen3.6-27b | 0.27 | 0.32 | **0.32** | 0.29 | 0.11 |
| qwen3.8-27b | 0.35 | 0.45 | 0.29 | **0.38** | 0.08 |
| allam-2-7b | 0.14 | 0.09 | 0.11 | 0.08 | **0.12** |

## Can one session be attributed from its marks? (leave-one-out naive Bayes; chance = 20% model, 33% family)
| marks used | model accuracy | family accuracy |
|---|---|---|
| animals | 46% (196 sessions) | 57% |
| numbers | 47% (197 sessions) | 57% |
| syllables | 43% (192 sessions) | 51% |
| symbols | 38% (187 sessions) | 56% |
| animals+numbers+syllables+symbols | 66% (172 sessions) | 78% |

## Position bias (order was shuffled every call; uniform = 8% per position)
| model | chose the FIRST listed | chose the LAST listed | n |
|---|---|---|---|
| gpt-oss-120b | 5% | 1% | 160 |
| gpt-oss-20b | 12% | 5% | 158 |
| qwen3.6-27b | 2% | 9% | 159 |
| qwen3.8-27b | 11% | 7% | 149 |
| allam-2-7b | 7% | 9% | 146 |
