import csv
import os

# Set the output directory name
output_dir = 'output'

# Create the output directory if it doesn't exist
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

# Get the path to the content.csv file in the same directory as the script
csv_file_path = os.path.join(os.path.dirname(__file__), 'content.csv')

# Open the CSV file
with open(csv_file_path, newline='') as csvfile:
    # Create a CSV reader object
    reader = csv.reader(csvfile)
    # Skip the first row (headings)
    next(reader, None)
    # Iterate over each row in the CSV file
    for row in reader:
        # Get the filename and contents from the row
        filename = row[0]
        contents = row[1]
        # Create the full path to the output file
        output_path = os.path.join(output_dir, filename)
        # Write the contents to the output file
        with open(output_path, 'w') as outfile:
            outfile.write(contents)
