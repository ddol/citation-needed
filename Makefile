MARKDOWN_PATH ?= papers/markdown
REEXTRACT_MARKDOWN_ARGS ?=

ifneq ($(strip $(DOI)),)
REEXTRACT_MARKDOWN_ARGS += --doi "$(DOI)"
endif

ifneq ($(strip $(LIMIT)),)
REEXTRACT_MARKDOWN_ARGS += --limit "$(LIMIT)"
endif

ifneq ($(strip $(MARKDOWN_PATH)),)
REEXTRACT_MARKDOWN_ARGS += --markdown-path "$(MARKDOWN_PATH)"
endif

.PHONY: reextract-markdown
reextract-markdown:
	npm run dev -- extract-markdown $(REEXTRACT_MARKDOWN_ARGS)
