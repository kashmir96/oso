---
title: Adding a Set Date to the Frontmatter of Markdown Files
description: This script allows the user to add a specific date to the frontmatter of markdown files in a directory.
date: 2023-02-07T00:00:00
type: Learn
category: ["Python", "File Management"]
tags: ["Markdown", "Datetime", "Frontmatter"]
---

# Introduction

This script is designed to add a specific date to the frontmatter of markdown files. The user provides the date in the format `dd/mm/yyyy` and the script will convert it to the ISO format and add it to the frontmatter of each markdown file in the `/add-dates` directory. After the date is added, the file will be moved to the `/dates-added` directory.

# Unique Features

What sets this script apart from the other date-adding scripts is its ability to allow the user to set a specific date for the frontmatter. This is useful when you want to add a date that is different from the current date or the date of the file creation.

# Usage

1. Copy the markdown files you want to add a date to into the `/add-dates` directory.
2. Run the script `date-adder-set.py` in your terminal.
3. Provide the date in the format `dd/mm/yyyy` when prompted.
4. The script will then add the date to the frontmatter of each markdown file in the `/add-dates` directory and move the files to the `/dates-added` directory.

# Conclusion

This script is a helpful tool for adding a specific date to the frontmatter of markdown files. If you're looking to set a specific date for your markdown files' frontmatter, this script is for you.

### Download the Script

You can download the script by visiting [./files/date-adder-set.py](./files/date-adder-set.py).
