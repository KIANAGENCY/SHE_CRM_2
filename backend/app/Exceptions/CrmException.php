<?php

namespace App\Exceptions;

use RuntimeException;

class CrmException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}
