import os

# Prompt user for the value to search for and the replacement value
search_value = input("Enter the value to search for: ")
replace_value = input("Enter the replacement value: ") + "\n"  # Add a new line to the end of the replacement value

# Get the current directory
current_dir = os.getcwd()

# Initialize a counter for the number of files edited
num_files_edited = 0

# Loop through all the files in the directory and its subdirectories
for root, dirs, files in os.walk(current_dir):
    for filename in files:
        if filename.endswith(".md"):
            # Print the current file being updated
            file_path = os.path.join(root, filename)
            print(f"Updating file: {file_path}")
            
            with open(file_path, "r") as file:
                lines = file.readlines()
            
            # Loop through the lines in the file and check if the search value is at the beginning of the line
            for i in range(len(lines)):
                if lines[i].startswith(search_value):
                    # Replace the line with the new value
                    lines[i] = replace_value
                    
            # Write the updated lines back to the file
            with open(file_path, "w") as file:
                file.writelines(lines)
            
            # Increment the counter for the number of files edited
            num_files_edited += 1

# Print the total number of files edited
print(f"Total number of files edited: {num_files_edited}")
