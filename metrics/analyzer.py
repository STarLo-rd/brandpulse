import pandas as pd
import os
import sys
from datetime import datetime

def generate_report(results_dir):
    # Read all CSV files
    report = pd.read_csv(os.path.join(results_dir, 'report.csv'))
    
    # Generate HTML report
    html = f"""
    <html>
    <head>
        <title>Benchmark Report - {datetime.now().strftime('%Y-%m-%d %H:%M')}</title>
        <style>
            table {{ border-collapse: collapse; width: 100%; }}
            th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
            tr:nth-child(even) {{ background-color: #f2f2f2; }}
            th {{ background-color: #4CAF50; color: white; }}
        </style>
    </head>
    <body>
        <h1>Performance Benchmark Report</h1>
        {report.to_html(index=False)}
    </body>
    </html>
    """
    
    # Save report
    output_path = os.path.join(results_dir, 'report.html')
    with open(output_path, 'w') as f:
        f.write(html)
    print(f"Report generated: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyzer.py <results_dir>")
        sys.exit(1)
    
    generate_report(sys.argv[1])