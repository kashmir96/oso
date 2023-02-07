---
title: "Adding Dates to Frontmatter - script 3: date-adder-now.py"
description: "This script adds the current date to the frontmatter of each .md file in the /add-dates directory and moves the processed files to the /dates-added directory."
date: 2023-02-07T12:34:56
type: Learn
category: ["Python", "File Management"]
tags: ["datetime", "os", "frontmatter", "current date"]
---

# Introduction

This script is designed to add the current date to the frontmatter of each markdown file in the `/add-dates` directory and then move the processed files to the `/dates-added` directory. It uses the `datetime` and `os` modules to accomplish this.

# Key Features

- Adds the current date in ISO format to the frontmatter of each .md file in the `/add-dates` directory.
- Moves the processed files to the `/dates-added` directory.

# Requirements

- Python 3 installed on your system.
- .md files to process stored in the `/add-dates` directory.

# Usage

1. Copy the .md files you wish to process into the `/add-dates` directory.
2. Run the script by executing `python date-adder-now.py` in the terminal.
3. The script will add the current date in ISO format to the frontmatter of each file and then move the processed files to the `/dates-added` directory.

# Download

To get your hands on this script, simply [download the file](./files/date-adder-now.py) and run it on your local machine.

