import sys

filename = sys.argv[1]

with open(filename, 'r') as file:
    file_content = file.read()

file_content_edited = file_content.replace("\n", "").replace(":", "")

bytes_result = bytes.fromhex(file_content_edited)

with open(filename + ".bin", "wb") as file:
    file.write(bytes_result)