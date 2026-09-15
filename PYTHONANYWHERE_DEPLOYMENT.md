# PythonAnywhere deployment

This dashboard is a static HTML/CSS/JavaScript application. It automatically loads:

`data/MA_2026_results_analysis.xlsx`

## Required folder structure

```text
ssc_result_dashboard_pythonanywhere/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── data-worker.js
├── data/
│   └── MA_2026_results_analysis.xlsx
└── verify_deployment.py
```

## Same PythonAnywhere account as an existing website

Upload the folder to:

`/home/YOUR_USERNAME/ssc_result_dashboard_pythonanywhere`

In the PythonAnywhere **Web** tab, add this Static Files mapping:

- URL: `/ssc-results/`
- Directory: `/home/YOUR_USERNAME/ssc_result_dashboard_pythonanywhere`

Reload the web app and open:

`https://YOUR_USERNAME.pythonanywhere.com/ssc-results/index.html`

## Separate PythonAnywhere site

Create a Manual Configuration web app, then add:

- URL: `/`
- Directory: `/home/YOUR_USERNAME/ssc_result_dashboard_pythonanywhere`

Reload and open the site domain.

## Verification

In a Bash console:

```bash
cd ~/ssc_result_dashboard_pythonanywhere
python3 verify_deployment.py
```

The script must report all five required files as `OK`.

## Important

The real Excel workbook is not included in this source package unless you manually copy it into the `data` folder. The filename must remain exactly:

`MA_2026_results_analysis.xlsx`
