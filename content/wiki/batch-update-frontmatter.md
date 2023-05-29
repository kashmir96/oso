---
title: "Batch Update Frontmatter of Markdown Files with Python"
description: "Learn how to use a Python script to update the frontmatter of multiple Markdown files at once."
type: "Learns"
---

## Introduction

As a content creator, you may have to manage a large number of Markdown files that contain metadata information in the frontmatter section. If you need to update this metadata in a batch of files, doing so manually can be time-consuming and error-prone. Fortunately, there's an easier way to update the frontmatter of multiple Markdown files at once.

This Python script searches for a specific value in the frontmatter of Markdown (.md) files within a directory and its subdirectories. If the script finds a line that starts with the specified value, it replaces the entire line with a new line that you provide. This can be useful if you need to update metadata in a batch of Markdown files.

## Usage

1. Open a command prompt or terminal window.
2. Navigate to the directory that contains the Markdown files you want to update.
3. Run the script by entering `python frontmatter_updater.py` and pressing Enter.
4. Follow the prompts to enter the search value and replacement value.
5. The script will loop through all the Markdown files within the directory and its subdirectories and update any lines that match the search value with the replacement value.

Note: It's always a good idea to make a backup of your files before running any scripts that modify them.

## Requirements

- Python 3.x
- The script must be saved as `frontmatter_updater.py` in the directory where the Markdown files are located.
- The Markdown files must have a `.md` file extension.

## Limitations

- This script assumes that each line in the frontmatter starts at the beginning of the line. If your frontmatter lines have whitespace at the beginning, you'll need to modify the script to account for that.
- This script replaces an entire line in the frontmatter with the replacement value. If you need to modify only part of a line, you'll need to modify the script accordingly.

## Download the Script

You can download the tool for free here: [Download the script](./files/line-replacer.py).
