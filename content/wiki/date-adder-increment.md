---
title: Adding Dates to Frontmatter in Increments with Python
description: A step-by-step guide on how to add a date to frontmatter in incremental order for multiple .md files using Python. 
date: 2023-02-07T00:00:00
type: Learn
category: ["Python"]
tags: ["Python", "File Management", "Dates", "Frontmatter"]
---

# Introduction

This script is for adding dates to frontmatter of multiple .md files in a directory. The script will read the contents of each .md file in the directory, look for the frontmatter, and add a date field in iso format. The date field will be in incremental order, meaning the first file processed will have the earliest date and the last file processed will have the latest date. This is useful for file management when you need to keep track of when files were added or processed.

## Requirements

Before running the script, make sure to copy the .md files you want to process into the directory `/add-dates`. 

## Running the Script

To run the script, simply call `python date-adder-increment.py` in your terminal or command prompt. The script will loop through all .md files in the `/add-dates` directory and add a date field to the frontmatter of each file. Once the script has completed, the edited .md files will be moved to the `/dates-added` directory.

## Output

The output of the script will be the number of files that were edited and moved to the `/dates-added` directory.

# Download the Script

To start adding dates to your .md files in incremental order, [download the script](./files/date-adder-increment.py) and run it on your local machine.
