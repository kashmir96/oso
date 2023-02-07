---
title: Increment Date Adder - Step by Step 
description: A Python script for adding incremental dates to markdown frontmatter. 
date: 2022-11-07T00:00:00 
type: Learn 
category: ["Python", "Scripting", "Automation"] 
tags: ["python", "scripting", "automation", "increment date", "frontmatter"] 
---

# Introduction

This Python script is designed to add incremental dates to the frontmatter of multiple markdown files. The script will iterate through the files in a specified directory, incrementing the date in the frontmatter by a specified step (in days). The script will then rename the file to indicate that the dates have been added. 

# How to Use 

1. Copy the markdown files you want to add incremental dates to into a directory called `/add-dates/`. 
2. Download the `date-adder-increment-step.py` file from the `./files/` directory. 
3. Run the script by opening a terminal, navigating to the directory where the script and `/add-dates/` directory are located, and executing the command `python date-adder-increment-step.py`. 
4. The script will prompt you for the number of days to increment the dates by. 
5. The script will then add incremental dates to the frontmatter of each file in the `/add-dates/` directory and move the files to a directory called `/dates-added/`. 

# What Makes this Script Unique 

This script is unique because it allows you to specify the step size of the date increments. This can be useful if you want to add a date every 2 or 3 days, for example. Additionally, the script ensures that the date format is in ISO format. 

# Conclusion 

If you are looking for an efficient way to add incremental dates to the frontmatter of multiple markdown files, this script is the solution you need. To get started, download the `date-adder-increment-step.py` file from the `./files/` directory. 
