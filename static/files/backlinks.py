import csv
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from bs4 import BeautifulSoup
import urllib.parse
import tldextract
import os.path

# Define a function to scrape a search phrase and write the results to a CSV file
def scrape_search_phrase(search_phrase):
    # Set up the URL
    query = urllib.parse.quote(search_phrase)
    url = f"https://www.google.com/search?q={query}"

    # Set up the headless browser options
    options = Options()
    options.headless = True

    # Set up the Selenium web driver with the headless browser options
    driver = webdriver.Firefox(options=options)
    driver.get(url)

    # Parse the HTML with BeautifulSoup
    soup = BeautifulSoup(driver.page_source, "html.parser")

    # Find the search results
    search_results = soup.find_all("div", class_="g")

    # Set up the CSV file and write the header row if the file does not exist
    if not os.path.isfile("search_results.csv"):
        with open("search_results.csv", "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(["Title", "URL", "Domain", "Search Phrase", "Search Position"])

    # Open the CSV file in append mode and write the new results to the end
    with open("search_results.csv", "a", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)

        # Loop through the search results and write each one to the CSV file
        for i, result in enumerate(search_results):
            try:
                title = result.find("h3").text.strip()
                url = result.find("a")["href"]
                domain = tldextract.extract(url).registered_domain
                writer.writerow([title, url, domain, search_phrase, i + 1])
            except AttributeError:
                continue

    # Close the web driver
    driver.quit()

# Define a function to prompt the user for a search phrase and scrape the results
def scrape_search_phrases():
    while True:
        # Prompt the user to enter a search phrase
        search_phrase = input("Enter the search phrase (or type 'exit' to quit): ")
        if search_phrase.lower() == "exit":
            break

        # Scrape the search phrase and write the results to a CSV file
        scrape_search_phrase(search_phrase)

        # Prompt the user if they want to scrape another keyword
        response = input("Do you want to scrape another keyword? (y/n) ")
        if response.lower() != "y":
            break

# Call the function to prompt the user for search phrases and scrape the results
scrape_search_phrases()
