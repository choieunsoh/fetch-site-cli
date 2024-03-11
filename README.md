## How to run the project
```bash
docker build -t fetch-site-cli .
docker run -it fetch-site-cli

# fetch site content
# fetch <url1> <url2> <url3> and so on
/app $ yarn fetch https://www.google.com

# query metadata
# fetch --metadata <url1> <url2> <url3> and so on
/app $ yarn fetch --metadata https://www.google.com
# or
/app $ yarn fetch -m https://www.google.com

```