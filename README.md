# Derrick Piano Cave — Free Converter Deployment

Deploy this folder as a Render web service using the Free instance type. The render.yaml blueprint explicitly selects plan: free, adds no disk, and generates a private service token. Do not add billing details or select a paid plan.

Free hosting uses temporary storage: a restart, redeploy or idle shutdown removes uploaded files and completed MP3s. Download results promptly. Interrupted jobs must be uploaded again. Render sleeps after inactivity and its next request can take about a minute to wake it.

Only this folder belongs in the converter repository. It contains no credentials. Do not upload the parent studio repository, personal recordings, local environment files or tokens.

After deployment, privately connect CONVERSION_SERVICE_URL and matching CONVERSION_SERVICE_TOKEN to the existing studio server. Never put the token in frontend JavaScript or chat.

Uploads and explicitly authorized direct media are supported. Direct YouTube retrieval is enabled with yt-dlp for owned or permitted recordings. YouTube may block the server; restricted or unavailable sources fail clearly. No cookies, proxies, sign-in or access-control bypass is configured.
