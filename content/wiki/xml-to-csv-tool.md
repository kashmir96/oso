---
title: "Sitemap Scraper"
description: "This is a Python script to scrape a sitemap and extract all the URLs from it."
type: "Learns"
cover: 
 image: /img/learns/8.webp
 alt: 
---

# Sitemap Scraper

This Python script is a simple tool for website owners and administrators to scrape a sitemap and extract all the URLs from it. A sitemap is a file that lists all the pages on a website and is used by search engines to crawl the website. With this script, website owners can easily extract all the URLs from their sitemap and save them in a CSV file.

## Requirements
- Python 3.x
- requests (Python library for making HTTP requests)
- BeautifulSoup (Python library for parsing HTML and XML)
- csv (Python library for reading and writing CSV files)

## Usage
1. Run the script in your terminal/command line.
2. Enter the sitemap URL when prompted.
3. The extracted URLs will be saved in a CSV file named "sitemap.csv".

## Implementation Details
- The script uses the requests library to fetch the sitemap HTML from the provided URL.
- The HTML is parsed using the BeautifulSoup library to extract all the URLs present in the "loc" elements.
- The extracted URLs are saved in a CSV file using the csv library. The file is named "sitemap.csv" and has a single column named "URL".

Note: This script assumes that the sitemap has a standard XML format and that the URLs are present in "loc" elements. If the sitemap format is different, you may need to modify the code accordingly.

## Download the Script
You can download the tool for free here: <a href="./files/xml-to-csv.py" download="xml-to-csv.py">Download the script</a>.