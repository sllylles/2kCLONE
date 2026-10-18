#!/usr/bin/env python3
"""Rebuild HoopLegacy.apk with the web game from ../www and sign it (APK Signature Scheme v2).

usage: repack.py BASE.apk OUT.apk [--www DIR] [--key KEY.pem --cert CERT.der]

Every entry of BASE.apk is copied as-is except the old v1 signature files and
assets/public/**, which are replaced by the contents of --www. Stored entries are
4-byte aligned (what zipalign does), then the v2 signing block is inserted before
the central directory. Needs the `cryptography` package.
"""
import argparse, hashlib, os, struct, sys, zipfile, datetime

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.x509.oid import NameOID

HERE = os.path.dirname(os.path.abspath(__file__))
STORE_EXT = ('.png', '.jpg', '.webp', '.arsc')


def load_or_make_key(key_path, cert_path):
    if os.path.exists(key_path) and os.path.exists(cert_path):
        key = serialization.load_pem_private_key(open(key_path, 'rb').read(), None)
        return key, open(cert_path, 'rb').read()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Hoop Legacy'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Hoop Legacy')])
    now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=365 * 30)).sign(key, hashes.SHA256()))
    open(key_path, 'wb').write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    der = cert.public_bytes(serialization.Encoding.DER)
    open(cert_path, 'wb').write(der)
    return key, der


def build_unsigned(base, out, www):
    entries = []
    with zipfile.ZipFile(base) as zin:
        for info in zin.infolist():
            n = info.filename
            if n.startswith('META-INF/') and n.rsplit('.', 1)[-1] in ('SF', 'RSA', 'DSA', 'EC', 'MF'):
                continue
            if n.startswith('assets/public/'):
                continue
            entries.append((n, zin.read(n), info.compress_type))
    for dirpath, _, files in os.walk(www):
        for f in sorted(files):
            full = os.path.join(dirpath, f)
            rel = 'assets/public/' + os.path.relpath(full, www).replace(os.sep, '/')
            data = open(full, 'rb').read()
            entries.append((rel, data, zipfile.ZIP_STORED if rel.endswith(STORE_EXT) else zipfile.ZIP_DEFLATED))
    with open(out, 'wb') as fp, zipfile.ZipFile(fp, 'w') as zout:
        for name, data, ctype in entries:
            zi = zipfile.ZipInfo(name, date_time=(1981, 1, 1, 1, 1, 2))
            zi.compress_type = ctype
            zi.external_attr = 0o644 << 16
            if ctype == zipfile.ZIP_STORED:
                # zipalign: data offset (after the 30-byte local header, name and extra) on a 4-byte boundary
                off = fp.tell() + 30 + len(name.encode())
                zi.extra = b'\0' * ((4 - off % 4) % 4)
            zout.writestr(zi, data)


def lp(b):
    return struct.pack('<I', len(b)) + b


def v2_sign(path, key, cert_der):
    data = open(path, 'rb').read()
    eocd = data.rfind(b'PK\x05\x06')
    cd_off = struct.unpack('<I', data[eocd + 16:eocd + 20])[0]
    sections = [data[:cd_off], data[cd_off:eocd], data[eocd:]]
    chunks = []
    for sec in sections:
        for i in range(0, len(sec), 1 << 20):
            c = sec[i:i + (1 << 20)]
            chunks.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
    digest = hashlib.sha256(b'\x5a' + struct.pack('<I', len(chunks)) + b''.join(chunks)).digest()
    ALG = 0x0103  # RSASSA-PKCS1-v1_5 with SHA2-256
    signed_data = lp(lp(struct.pack('<I', ALG) + lp(digest))) + lp(lp(cert_der)) + lp(b'')
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed_data) + lp(lp(struct.pack('<I', ALG) + lp(sig))) + lp(pub)
    value = lp(lp(signer))
    pair = struct.pack('<Q', 4 + len(value)) + struct.pack('<I', 0x7109871a) + value
    size = len(pair) + 8 + 16
    block = struct.pack('<Q', size) + pair + struct.pack('<Q', size) + b'APK Sig Block 42'
    new_eocd = bytearray(sections[2])
    new_eocd[16:20] = struct.pack('<I', cd_off + len(block))
    open(path, 'wb').write(sections[0] + block + sections[1] + bytes(new_eocd))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('base'); ap.add_argument('out')
    ap.add_argument('--www', default=os.path.join(HERE, '..', 'www'))
    ap.add_argument('--key', default=os.path.join(HERE, 'signing-key.pem'))
    ap.add_argument('--cert', default=os.path.join(HERE, 'signing-cert.der'))
    a = ap.parse_args()
    key, cert = load_or_make_key(a.key, a.cert)
    build_unsigned(a.base, a.out, a.www)
    v2_sign(a.out, key, cert)
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')


if __name__ == '__main__':
    sys.exit(main())
