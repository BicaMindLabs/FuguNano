.DEFAULT_GOAL := help
SHELL := /usr/bin/env bash

.PHONY: help install install-cc install-skill verify doctor test scan lint check-docs ci

help: ## 列出可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

install: ## 装启动器到 ~/bin (镜像 backends/bin)
	./backends/install.sh

install-cc: ## 装启动器并把 pinned claude-code 装进各 env
	./backends/install.sh --install-claude-code

verify: ## 启动器自检 + cc-models doctor
	./backends/verify.sh && cc-models doctor

doctor: ## 环境侦察 + 工作流推荐 (在任意机器上跑)
	bash orchestration/fanout/fanout doctor

install-skill: ## 装成 Claude Code skill (~/.claude/skills/fanout, 已存在先备份)
	bash scripts/install-skill.sh

test: ## 跑 cn-plugin 测试 (node)
	npm test

scan: ## 密钥泄漏扫描 (本地闸门)
	bash scripts/scan-secrets.sh

lint: ## 脚本语法 (bash -n) + shellcheck
	bash scripts/check-shell.sh

check-docs: ## 文档漂移闸门 (README 子命令/数量 == 实际代码)
	bash scripts/check-docs.sh

ci: scan lint check-docs test ## 本地完整 CI (scan + lint + check-docs + test)
