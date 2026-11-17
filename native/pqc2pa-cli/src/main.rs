mod attach_timestamp;
mod extract_classic;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "pqc2pa-cli")]
#[command(version)]
#[command(about = "PQ-C2PA native manifest utility")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Classic C2PA에서 active COSE 서명과 RFC 3161 토큰을 추출한다.
    ExtractClassic {
        #[arg(long)]
        input: PathBuf,

        #[arg(long)]
        output: PathBuf,
    },

    /// sigTst2용 RFC 3161 입력 바이트를 생성한다.
    TimestampInput {
        #[arg(long)]
        input: PathBuf,

        #[arg(long)]
        output: PathBuf,
    },

    /// 기존 Classic COSE 서명에 sigTst2를 삽입한다.
    AttachTimestamp {
        #[arg(long)]
        input: PathBuf,

        #[arg(long)]
        output: PathBuf,

        #[arg(long)]
        token: PathBuf,
    },

    /// 이미지에서 전체 Classic Manifest Store 원본을 추출한다.
    ExportStore {
        #[arg(long)]
        input: PathBuf,

        #[arg(long)]
        output: PathBuf,
    },

    /// 저장된 Classic Manifest Store를 메타데이터가 없는 이미지에 다시 삽입한다.
    RestoreStore {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        store: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::ExtractClassic { input, output } => {
            extract_classic::extract_classic(&input, &output)?;
        }

        Command::TimestampInput { input, output } => {
            attach_timestamp::write_timestamp_input(&input, &output)?;
        }

        Command::AttachTimestamp {
            input,
            output,
            token,
        } => {
            attach_timestamp::attach_timestamp(&input, &output, &token)?;
        }

        Command::ExportStore { input, output } => {
            let bytes = c2pa::jumbf_io::load_jumbf_from_file(&input)?;

            // 기존 파일은 덮어쓰지 않는다.
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&output)?;

            use std::io::Write;
            file.write_all(&bytes)?;
        }
        Command::RestoreStore { input, store, output } => {
            anyhow::ensure!(input != output, "input and output must differ");
            anyhow::ensure!(!output.exists(), "output already exists");
            let bytes = std::fs::read(store)?;
            c2pa::jumbf_io::save_jumbf_to_file(&bytes, input, Some(output))?;
        }
    }

    Ok(())
}
