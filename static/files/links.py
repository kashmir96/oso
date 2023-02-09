import csv
import os

def add_links_to_files(key_phrases_and_links):
    directory = os.path.dirname(os.path.abspath(__file__))
    edited_files = 0
    total_links = 0
    for filename in os.listdir(directory):
        if filename.endswith(".md"):
            frontmatter_flag = True
            frontmatter_counter = 0
            file_path = os.path.join(directory, filename)
            with open(file_path, "r") as f:
                lines = f.readlines()
            with open(file_path, "w") as f:
                for line in lines:
                    if frontmatter_flag:
                        if line.strip() == "---":
                            frontmatter_counter += 1
                        if frontmatter_counter == 2:
                            frontmatter_flag = False
                        f.write(line)
                        continue
                    if line.strip().startswith("#"):
                        f.write(line)
                        continue
                    for key_phrase, link in key_phrases_and_links.items():
                        if (key_phrase.lower() in line.lower() and
                            "[" not in line and
                            "]" not in line and
                            "<a" not in line and
                            "</a>" not in line):
                            line = line.replace(key_phrase, f"[{key_phrase}]({link})")
                            total_links += 1
                    f.write(line)
            edited_files += 1
    print(f"Total files edited: {edited_files}")
    print(f"Total links added: {total_links}")

if __name__ == "__main__":
    key_phrases_and_links = {}
    csv_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "links.csv")
    with open(csv_file, "r") as f:
        reader = csv.reader(f)
        for row in reader:
            key_phrases_and_links[row[0]] = row[1]
    add_links_to_files(key_phrases_and_links)
