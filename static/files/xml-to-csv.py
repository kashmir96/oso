import csv
import requests
from bs4 import BeautifulSoup

# Fetch the sitemap from the URL
url = input("Enter the sitemap URL: ")
response = requests.get(url)

# Parse the sitemap with BeautifulSoup
soup = BeautifulSoup(response.text, "lxml")

# Open a CSV file for writing
with open("sitemap.csv", "w", newline="") as csvfile:
    # Create a CSV writer
    writer = csv.writer(csvfile)

    # Write the header row to the CSV
    writer.writerow(["URL"])

    # Loop through each "loc" element in the HTML
    for loc in soup.select("loc"):
        # Write the URL to the CSV
        writer.writerow([loc.text.strip()])
        print("Added URL to CSV:", loc.text.strip())
